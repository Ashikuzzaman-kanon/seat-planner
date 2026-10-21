const asyncHandler = require("../utils/asyncHandler");
const allocation = require("../services/allocationService");

const filters = (q) => ({
  from: q.from || undefined,
  to: q.to || undefined,
  train: q.train || undefined,
  classCode: q.class || undefined,
});

const meta = asyncHandler(async (_req, res) => {
  res.json(await allocation.meta());
});

const list = asyncHandler(async (req, res) => {
  res.json(
    await allocation.list({
      ...filters(req.query),
      show: req.query.show,
      page: req.query.page,
      pageSize: req.query.pageSize,
    })
  );
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
    const result = await importer(req.body, { apply, actor: req.user });
    res.json({ message: apply ? "Applied" : "Read — nothing has changed yet", ...result });
  });

const savePair = asyncHandler(async (req, res) => {
  const pair = await allocation.savePair(req.body, req.user);
  res.json({ message: "Saved", pair });
});

const clearPair = asyncHandler(async (req, res) => {
  await allocation.clearPair({ train: req.query.train, from: req.query.from, to: req.query.to });
  res.json({ message: "Back to not checked" });
});

module.exports = {
  meta,
  list,
  countsSheet,
  importStops: upload(allocation.importStops),
  importCensus: upload(allocation.importCensus),
  importCounts: upload(allocation.importCounts),
  savePair,
  clearPair,
};
