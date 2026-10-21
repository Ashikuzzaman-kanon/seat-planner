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
const canManage = requirePermission(PERMISSIONS.ALLOCATION_MANAGE);

const station = (where, field) => where(field).optional({ values: "falsy" }).isString().isLength({ max: 100 });
const filterRules = [
  station(query, "from"),
  station(query, "to"),
  query("train").optional({ values: "falsy" }).isInt({ min: 1, max: 99999 }).withMessage("train is a train number"),
  query("class").optional({ values: "falsy" }).matches(/^[A-Za-z][A-Za-z0-9_]{0,19}$/).withMessage("class is a class code, such as S_CHAIR"),
];

router.get("/meta", canView, c.meta);
router.get(
  "/",
  canView,
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

// Files come as plain text, up to a few megabytes: the census of every pair
// is far beyond the 100 kB a JSON body may be.
const file = [
  express.text({ type: () => true, limit: "10mb" }),
  body()
    .custom((value) => typeof value === "string" && value.trim().length > 0)
    .withMessage("Send the file's contents as the request body, as text/plain"),
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
