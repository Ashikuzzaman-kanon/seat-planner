const express = require("express");
const { body, query } = require("express-validator");
const router = express.Router();
const c = require("../controllers/allocationController");
const authenticate = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const validate = require("../middleware/validate");
const { PERMISSIONS } = require("../constants/permissions");

/*
 * Seat allocation: the railway's own data on which pairs have seats, kept
 * apart from everything the site books on (services/allocationService).
 */
router.use(authenticate);

const canView = requirePermission(PERMISSIONS.ALLOCATION_VIEW);

/*
 * While Seat Allocation is open to the public, everyone signed in may see it
 * in the app too — the filters, the list and the grid. Who uploaded what, the
 * upload history and the counts sheet stay with those who hold
 * allocation:view.
 */
const publicAllocation = require("../services/publicAllocationService");
function canSee(req, res, next) {
  if (req.permissions?.has(PERMISSIONS.ALLOCATION_VIEW) || publicAllocation.enabled()) return next();
  return canView(req, res, next);
}
const canManage = requirePermission(PERMISSIONS.ALLOCATION_MANAGE);
const canSeeRequests = requirePermission(PERMISSIONS.ALLOCATION_REQUESTS);

const station = (where, field) => where(field).optional({ values: "falsy" }).isString().isLength({ max: 100 });
const filterRules = [
  station(query, "from"),
  station(query, "to"),
  query("train").optional({ values: "falsy" }).isInt({ min: 1, max: 99999 }).withMessage("train is a train number"),
  query("class").optional({ values: "falsy" }).matches(/^[A-Za-z][A-Za-z0-9_]{0,19}$/).withMessage("class is a class code, such as S_CHAIR"),
];

router.get("/meta", canSee, c.meta);
router.get(
  "/",
  canSee,
  [
    ...filterRules,
    query("show").optional().isIn(["allocated", "all"]).withMessage("show is allocated or all"),
    query("page").optional().isInt({ min: 1 }),
    query("pageSize").optional().isInt({ min: 1, max: 1000 }),
  ],
  validate,
  c.list
);
router.get("/counts.csv", canView, filterRules, validate, c.countsSheet);
router.get("/uploads", canView, [query("limit").optional().isInt({ min: 1, max: 100 })], validate, c.uploads);
// Who looks at it, and for what — on the public page and in the app
// (services/allocationRequestService checks each field and filter itself).
const requestRules = [
  query("by").optional().matches(/^[A-Za-z]+(,[A-Za-z]+)?$/).withMessage("by is one or two fields, such as train,outcome"),
  query("w")
    .optional()
    .custom((w) => (Array.isArray(w) ? w : [w]).every((x) => typeof x === "string" && x.length <= 320))
    .withMessage("w is field:value, such as train:705"),
  query("since").optional().isDate({ format: "YYYY-MM-DD", strictMode: true }).withMessage("since is a day, YYYY-MM-DD"),
  query("until").optional().isDate({ format: "YYYY-MM-DD", strictMode: true }).withMessage("until is a day, YYYY-MM-DD"),
  query("all").optional().isIn(["0", "1", "true", "false"]),
];
router.get("/requests", canSeeRequests, requestRules, validate, c.requestAnalysis);
router.get("/requests.csv", canSeeRequests, requestRules, validate, c.requestSheet);
router.get("/requests/today", canSeeRequests, c.requestsToday);
// How the public page is used, at a glance.
router.get("/public-visits", canSeeRequests, c.publicVisits);

// Files come as plain text, up to a few megabytes: the census of every pair
// is far beyond the 100 kB a JSON body may be.
const file = [
  express.text({ type: () => true, limit: "10mb" }),
  body()
    .custom((value) => typeof value === "string" && value.trim().length > 0)
    .withMessage("Send the file's contents as the request body, as text/plain"),
  query("name").optional().isString().isLength({ max: 200 }).withMessage("name is the file's name"),
];
router.post("/import/stops", canManage, file, validate, c.importStops);
router.post("/import/census", canManage, file, validate, c.importCensus);
router.post("/import/counts", canManage, file, validate, c.importCounts);

const pairRules = (where) => [
  where("train").isInt({ min: 1, max: 99999 }).withMessage("train is a train number"),
  where("from").isString().trim().isLength({ min: 1, max: 100 }).withMessage("from is a station"),
  where("to").isString().trim().isLength({ min: 1, max: 100 }).withMessage("to is a station"),
];
router.put(
  "/pairs",
  canManage,
  [
    ...pairRules(body),
    body("status").isIn(["allocated", "not_allocated"]).withMessage("status is allocated or not_allocated"),
    body("classes").optional().isArray({ max: 20 }).withMessage("classes is a list"),
  ],
  validate,
  c.savePair
);
router.delete("/pairs", canManage, pairRules(query), validate, c.clearPair);

module.exports = router;
