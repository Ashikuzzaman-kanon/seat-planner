const express = require("express");
const { body, query } = require("express-validator");
const router = express.Router();
const asyncHandler = require("../utils/asyncHandler");
const validate = require("../middleware/validate");
const ApiError = require("../utils/ApiError");
const { readVisitor } = require("../utils/publicRequest");
const { setContext } = require("../utils/requestContext");
const { verifyAccessToken } = require("../services/tokenService");
const { User } = require("../models");
const { VISIT_OUTCOMES } = require("../models/PublicVisit");
const publicAllocation = require("../services/publicAllocationService");

/*
 * Seat Allocation for everyone (/seat-allocation): read-only, no sign-in.
 * See services/publicAllocationService for the limits, the bot check and the
 * free searches. Reached through the web app's server, which vouches for the
 * visitor's address (utils/publicRequest).
 */

/** Who is asking: the visitor as far as can be told, and who they are if signed in. */
const who = asyncHandler(async (req, _res, next) => {
  req.visitor = readVisitor(req);
  req.publicUser = null;
  const [scheme, token] = String(req.headers.authorization || "").split(" ");
  if (scheme === "Bearer" && token) {
    try {
      const user = await User.findByPk(verifyAccessToken(token).sub);
      if (user && user.isVerified && !user.restrictedAt) req.publicUser = user;
    } catch {
      /* an expired or wrong token: just a visitor */
    }
  }
  setContext({
    ipAddress: req.visitor.ip,
    userAgent: req.visitor.userAgent,
    ...(req.publicUser ? { actor: { id: req.publicUser.id, email: req.publicUser.email, roles: [] } } : {}),
  });
  next();
});

const kindOf = (req) => (req.path === "/meta" ? "meta" : req.path === "/pass" ? "pass" : "list");

function open(req, _res, next) {
  if (publicAllocation.enabled()) return next();
  next(publicAllocation.offError());
}

/** Only through the web app's server, when a shared secret is set. */
function vouched(req, _res, next) {
  if (req.visitor.vouched !== false) return next();
  publicAllocation.record(req.visitor, { kind: kindOf(req), outcome: VISIT_OUTCOMES.REFUSED });
  const error = ApiError.forbidden("Open Seat Allocation from the website.");
  error.code = "REFUSED";
  next(error);
}

function limited(req, _res, next) {
  try {
    publicAllocation.throttle(req.visitor, kindOf(req), req.publicUser);
    next();
  } catch (err) {
    next(err);
  }
}

router.use(who);

// Whether the page is open: the sign-in page asks, to show its button.
router.get("/status", (req, res) => res.json(publicAllocation.status()));

router.use(open, vouched, limited);

router.get(
  "/meta",
  asyncHandler(async (req, res) => {
    const meta = await publicAllocation.meta();
    publicAllocation.record(req.visitor, { kind: "meta", outcome: VISIT_OUTCOMES.SHOWN, user: req.publicUser });
    res.json({ ...meta, ...publicAllocation.status(), signedIn: Boolean(req.publicUser) });
  })
);

const station = (field) => query(field).optional({ values: "falsy" }).isString().isLength({ max: 100 });
router.get(
  "/",
  [
    station("from"),
    station("to"),
    query("train").optional({ values: "falsy" }).isInt({ min: 1, max: 99999 }).withMessage("train is a train number"),
    query("class").optional({ values: "falsy" }).matches(/^[A-Za-z][A-Za-z0-9_]{0,19}$/).withMessage("class is a class code"),
    query("show").optional().isIn(["allocated", "all"]),
    query("page").optional().isInt({ min: 1, max: 100000 }),
    query("pageSize").optional().isInt({ min: 1, max: 1000 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    publicAllocation.requirePass(req.visitor, req.headers["x-sp-pass"], req.publicUser, "list");
    res.json(
      await publicAllocation.list(
        req.visitor,
        {
          from: req.query.from || undefined,
          to: req.query.to || undefined,
          train: req.query.train || undefined,
          classCode: req.query.class || undefined,
          show: req.query.show,
          page: req.query.page,
          pageSize: req.query.pageSize,
        },
        req.publicUser
      )
    );
  })
);

router.post(
  "/pass",
  [body("token").isString().isLength({ min: 1, max: 4096 }).withMessage("token is the bot check's answer")],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await publicAllocation.pass(req.visitor, req.body.token));
  })
);

module.exports = router;
