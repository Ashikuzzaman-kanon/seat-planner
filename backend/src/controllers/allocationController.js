const asyncHandler = require("../utils/asyncHandler");
const allocation = require("../services/allocationService");

const filters = (q) => ({
  from: q.from || undefined,
  to: q.to || undefined,
  train: q.train || undefined,
  classCode: q.class || undefined,
});

const { PERMISSIONS } = require("../constants/permissions");
const publicAllocation = require("../services/publicAllocationService");
const requests = require("../services/allocationRequestService");
const { readVisitor } = require("../utils/publicRequest");

/**
 * Without allocation:view (seeing it because it is public), only when the
 * data was brought up to date — not who uploaded which file.
 */
const meta = asyncHandler(async (req, res) => {
  const m = await allocation.meta();
  if (req.permissions?.has(PERMISSIONS.ALLOCATION_VIEW)) return res.json({ ...m, staff: true });
  const at = (x) => (x ? { at: x.at, scannedFrom: x.scannedFrom ?? null, scannedTo: x.scannedTo ?? null } : null);
  res.json({ ...m, latest: { stops: at(m.latest?.stops), census: at(m.latest?.census), counts: at(m.latest?.counts) }, staff: false });
});

const publicVisits = asyncHandler(async (_req, res) => {
  res.json(await publicAllocation.visits());
});

/** A search in the app: answered, and recorded as one of the requests (channel "app"). */
const list = asyncHandler(async (req, res) => {
  const asked = { ...filters(req.query), show: req.query.show, page: req.query.page, pageSize: req.query.pageSize };
  const result = await allocation.list(asked);
  await requests.recordAppSearch(readVisitor(req), req.user, asked, result.total);
  if (req.permissions?.has(PERMISSIONS.ALLOCATION_VIEW)) return res.json(result);
  // Where a pair came from (census or by hand) is for staff.
  res.json({ ...result, items: result.items.map(({ source, ...rest }) => rest) });
});

const countsSheet = asyncHandler(async (req, res) => {
  const csv = await allocation.countsSheet(filters(req.query));
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", 'attachment; filename="seat-counts.csv"');
  res.send(csv);
});

/** The file arrives as the request body, as text; `?apply=1` applies it, anything else only reads it. */
const upload = (importer) =>
  asyncHandler(async (req, res) => {
    const apply = req.query.apply === "1" || req.query.apply === "true";
    const fileName = typeof req.query.name === "string" ? req.query.name.trim() || null : null;
    const result = await importer(req.body, { apply, actor: req.user, fileName });
    res.json({ message: apply ? "Applied" : "Read — nothing has changed yet", ...result });
  });

const uploads = asyncHandler(async (req, res) => {
  res.json({ uploads: await allocation.uploads({ limit: req.query.limit }) });
});

const savePair = asyncHandler(async (req, res) => {
  const pair = await allocation.savePair(req.body, req.user);
  res.json({ message: "Saved", pair });
});

const clearPair = asyncHandler(async (req, res) => {
  await allocation.clearPair({ train: req.query.train, from: req.query.from, to: req.query.to });
  res.json({ message: "Back to not checked" });
});

/** Who looks at the seat allocation, and for what: grouped and counted. */
const requestAnalysis = asyncHandler(async (req, res) => {
  res.json(await requests.analyse(req.query));
});

const requestSheet = asyncHandler(async (req, res) => {
  const text = await requests.csv(req.query);
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", 'attachment; filename="allocation-requests.csv"');
  res.send(text);
});

const requestsToday = asyncHandler(async (_req, res) => {
  res.json(await requests.today());
});

module.exports = {
  meta,
  list,
  countsSheet,
  uploads,
  publicVisits,
  requestAnalysis,
  requestSheet,
  requestsToday,
  importStops: upload(allocation.importStops),
  importCensus: upload(allocation.importCensus),
  importCounts: upload(allocation.importCounts),
  savePair,
  clearPair,
};
