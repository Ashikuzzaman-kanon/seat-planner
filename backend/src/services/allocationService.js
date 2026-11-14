const { sequelize, AllocationTrain, AllocationPair, AllocationClass, AllocationUpload, User } = require("../models");
const { ALLOCATION_STATUS, ALLOCATION_SOURCE } = require("../models/AllocationPair");
const { UPLOAD_KINDS } = require("../models/AllocationUpload");
const ApiError = require("../utils/ApiError");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { readCensus, readStops, readCounts, CLASS_CODE, MAX_SEATS } = require("../utils/allocationFiles");
const { toCsv } = require("../utils/csv");
const audit = require("./auditService");

/**
 * Seat allocation: which station pairs the railway actually sets seats aside
 * for, per train and class — a view of the railway's own data, uploaded from
 * the census its booking site was scanned into. Stored apart from everything
 * the site books on (see the migration), and changed only here.
 *
 * At most a few thousand pairs, so the whole set is kept in memory and every
 * filter, summary and page is worked out from it; any change reloads it. Like
 * the settings cache, this is per process.
 *
 * The railway can change its allocation at any time, so how current the data
 * is is always shown: when each pair was checked against the railway, when
 * each count was last set, and every file applied (allocation_uploads).
 */

const NOT_CHECKED = "not_checked";
const CHUNK = 1000;
const LIST_MAX = 1000;
const SKIPPED_SHOWN = 500;

const keyOf = (train, from, to) => `${train}|${from}|${to}`;

let cache = null;

async function load() {
  const [trains, pairs, classes] = await Promise.all([
    AllocationTrain.findAll(),
    AllocationPair.findAll({
      attributes: ["id", "trainNumber", "fromStation", "toStation", "status", "checkedAt", "source", "updatedAt"],
      raw: true,
    }),
    AllocationClass.findAll({
      attributes: ["id", "pairId", "classCode", "seats", "seatsUpdatedAt", "seatsUpdatedById"],
      raw: true,
    }),
  ]);

  const byPair = new Map();
  for (const c of classes) {
    if (!byPair.has(c.pairId)) byPair.set(c.pairId, []);
    byPair.get(c.pairId).push({
      id: c.id,
      code: c.classCode,
      seats: c.seats,
      seatsUpdatedAt: c.seatsUpdatedAt,
      seatsUpdatedById: c.seatsUpdatedById,
    });
  }

  const trainMap = new Map();
  for (const t of trains) {
    const stops = Array.isArray(t.stops) ? t.stops : null;
    const pos = new Map();
    (stops || []).forEach((s, i) => !pos.has(s) && pos.set(s, i));
    trainMap.set(t.number, { number: t.number, name: t.name, stops, pos, stopsUpdatedAt: t.stopsUpdatedAt });
  }

  const list = pairs.map((p) => ({
    id: p.id,
    train: p.trainNumber,
    from: p.fromStation,
    to: p.toStation,
    status: p.status,
    checkedAt: p.checkedAt,
    source: p.source,
    updatedAt: p.updatedAt,
    classes: (byPair.get(p.id) || []).sort((a, b) => a.code.localeCompare(b.code)),
  }));
  return { trains: trainMap, pairs: list, byKey: new Map(list.map((p) => [keyOf(p.train, p.from, p.to), p])) };
}

async function dataset() {
  if (!cache) cache = await load();
  return cache;
}

function invalidate() {
  cache = null;
}

/** Where a pair sits on its train's route: both stations on it, in that order. */
function onRoute(train, from, to) {
  if (!train?.stops) return null; // route not uploaded: cannot say
  const a = train.pos.get(from);
  const b = train.pos.get(to);
  return a !== undefined && b !== undefined && a < b;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const later = (a, b) => (!a || (b && b > a) ? b : a);
const earlier = (a, b) => (!a || (b && b < a) ? b : a);

/**
 * When each kind of file last came in, from the upload history — or, for data
 * applied before there was a history, from the data itself, without a name.
 * Counts can also be typed in by hand, so theirs is the last count changed.
 */
async function latest(d) {
  const newest = (kind) =>
    AllocationUpload.findOne({
      where: { kind },
      include: [{ model: User, as: "uploadedBy", attributes: ["id", "fullName"] }],
      order: [["id", "DESC"]],
    });
  const [stops, census] = await Promise.all([newest(UPLOAD_KINDS.STOPS), newest(UPLOAD_KINDS.CENSUS)]);

  let routesAt = null;
  for (const t of d.trains.values()) routesAt = later(routesAt, t.stopsUpdatedAt);

  let censusAt = null;
  let scannedFrom = null;
  let scannedTo = null;
  let count = null;
  for (const p of d.pairs) {
    if (p.source === ALLOCATION_SOURCE.CENSUS) {
      censusAt = later(censusAt, p.updatedAt);
      scannedFrom = earlier(scannedFrom, p.checkedAt);
      scannedTo = later(scannedTo, p.checkedAt);
    }
    for (const c of p.classes) if (c.seatsUpdatedAt && (!count || c.seatsUpdatedAt > count.at)) count = { at: c.seatsUpdatedAt, by: c.seatsUpdatedById };
  }
  const countBy = count?.by ? await User.findByPk(count.by, { attributes: ["id", "fullName"] }) : null;

  const fromUpload = (u) => ({
    at: u.createdAt,
    by: u.uploadedBy ? { id: u.uploadedBy.id, fullName: u.uploadedBy.fullName } : null,
    fileName: u.fileName,
    summary: u.summary,
  });
  return {
    stops: stops ? fromUpload(stops) : routesAt ? { at: routesAt, by: null, fileName: null, summary: null } : null,
    census: census
      ? { ...fromUpload(census), scannedFrom: census.scannedFrom, scannedTo: census.scannedTo }
      : censusAt
      ? { at: censusAt, by: null, fileName: null, summary: null, scannedFrom, scannedTo }
      : null,
    counts: count ? { at: count.at, by: countBy ? { id: countBy.id, fullName: countBy.fullName } : null } : null,
  };
}

/** What there is to filter by, how much data there is, and how current it is. */
async function meta() {
  const d = await dataset();
  const stations = new Set();
  const classes = new Set();
  let updatedAt = null;
  for (const t of d.trains.values()) (t.stops || []).forEach((s) => stations.add(s));
  for (const p of d.pairs) {
    stations.add(p.from);
    stations.add(p.to);
    p.classes.forEach((c) => classes.add(c.code));
    if (!updatedAt || p.updatedAt > updatedAt) updatedAt = p.updatedAt;
  }
  const classRows = d.pairs.flatMap((p) => p.classes);
  return {
    trains: [...d.trains.values()]
      .sort((a, b) => a.number - b.number)
      .map((t) => ({ number: t.number, name: t.name, hasStops: Boolean(t.stops) })),
    stations: [...stations].sort((a, b) => a.localeCompare(b)),
    classes: [...classes].sort((a, b) => a.localeCompare(b)),
    totals: {
      trains: d.trains.size,
      trainsWithStops: [...d.trains.values()].filter((t) => t.stops).length,
      pairs: d.pairs.length,
      allocated: d.pairs.filter((p) => p.status === ALLOCATION_STATUS.ALLOCATED).length,
      notAllocated: d.pairs.filter((p) => p.status === ALLOCATION_STATUS.NOT_ALLOCATED).length,
      classes: classRows.length,
      counted: classRows.filter((c) => c.seats !== null).length,
    },
    updatedAt,
    latest: await latest(d),
  };
}

/** The files applied, newest first. */
async function uploads({ limit = 20 } = {}) {
  const rows = await AllocationUpload.findAll({
    include: [{ model: User, as: "uploadedBy", attributes: ["id", "fullName"] }],
    order: [["id", "DESC"]],
    limit: Math.min(Math.max(Number(limit) || 20, 1), 100),
  });
  return rows.map((u) => u.toPublicJSON());
}

/**
 * The pairs that match: any of from, to, train and class, each left out to
 * mean "all". Only allocated pairs unless `show` is "all", which adds the pairs
 * checked and found not allocated, and — from the uploaded routes — the pairs
 * nobody has checked yet. With one train chosen they come in route order.
 */
async function list({ from, to, train, classCode, show = "allocated", page = 1, pageSize = 50 } = {}) {
  const d = await dataset();
  const trainNo = train ? Number(train) : null;
  const all = show === "all";
  const code = classCode ? String(classCode).toUpperCase() : null;
  const match = (p) => (!trainNo || p.train === trainNo) && (!from || p.from === from) && (!to || p.to === to);

  const rows = [];
  for (const p of d.pairs) {
    if (!match(p)) continue;
    if (!all && p.status !== ALLOCATION_STATUS.ALLOCATED) continue;
    if (code && !(p.status === ALLOCATION_STATUS.ALLOCATED && p.classes.some((c) => c.code === code))) continue;
    rows.push(p);
  }
  if (all && !code) {
    const seen = new Set();
    for (const t of d.trains.values()) {
      if (!t.stops || (trainNo && t.number !== trainNo)) continue;
      for (let i = 0; i < t.stops.length; i++) {
        for (let j = i + 1; j < t.stops.length; j++) {
          const pair = { train: t.number, from: t.stops[i], to: t.stops[j] };
          if (pair.from === pair.to || !match(pair)) continue;
          const key = keyOf(pair.train, pair.from, pair.to);
          if (d.byKey.has(key) || seen.has(key)) continue;
          seen.add(key);
          rows.push({ ...pair, status: NOT_CHECKED, checkedAt: null, source: null, classes: [] });
        }
      }
    }
  }

  const far = Number.MAX_SAFE_INTEGER;
  if (trainNo) {
    const t = d.trains.get(trainNo);
    const at = (s) => t?.pos.get(s) ?? far;
    rows.sort((a, b) => at(a.from) - at(b.from) || at(a.to) - at(b.to) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  } else {
    rows.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.train - b.train);
  }

  const summary = summarise(rows);
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), LIST_MAX);
  const pageNo = Math.max(Number(page) || 1, 1);
  const items = rows.slice((pageNo - 1) * size, pageNo * size).map((p) => present(d, p));
  // With one train chosen, its stations in order: the grid's rows and columns.
  const route = trainNo ? d.trains.get(trainNo)?.stops || null : undefined;
  return { items, total: rows.length, page: pageNo, pageSize: size, summary, route };
}

function summarise(rows) {
  const trains = new Set();
  const stations = new Set();
  const counts = { allocated: 0, not_allocated: 0, not_checked: 0 };
  const classes = new Map();
  let checkedFrom = null;
  let checkedTo = null;
  let countsFrom = null;
  let countsTo = null;
  for (const p of rows) {
    trains.add(p.train);
    stations.add(p.from);
    stations.add(p.to);
    counts[p.status]++;
    checkedFrom = earlier(checkedFrom, p.checkedAt);
    checkedTo = later(checkedTo, p.checkedAt);
    for (const c of p.classes) {
      const s = classes.get(c.code) || { code: c.code, pairs: 0, counted: 0, seats: 0 };
      s.pairs++;
      if (c.seats !== null) {
        s.counted++;
        s.seats += c.seats;
        countsFrom = earlier(countsFrom, c.seatsUpdatedAt);
        countsTo = later(countsTo, c.seatsUpdatedAt);
      }
      classes.set(c.code, s);
    }
  }
  return {
    trains: trains.size,
    pairs: rows.length,
    stations: stations.size,
    allocated: counts.allocated,
    notAllocated: counts.not_allocated,
    notChecked: counts.not_checked,
    // When the pairs shown were checked against the railway: the oldest and the newest.
    checkedFrom,
    checkedTo,
    // When the seat counts shown were set: the oldest and the newest.
    countsFrom,
    countsTo,
    classes: [...classes.values()].sort((a, b) => b.pairs - a.pairs || a.code.localeCompare(b.code)),
  };
}

function present(d, p) {
  const t = d.trains.get(p.train);
  return {
    train: { number: p.train, name: t?.name || `Train ${p.train}` },
    from: p.from,
    to: p.to,
    status: p.status,
    checkedAt: p.checkedAt,
    source: p.source,
    onRoute: onRoute(t, p.from, p.to),
    classes: p.classes.map((c) => ({ code: c.code, seats: c.seats, seatsUpdatedAt: c.seatsUpdatedAt || null })),
  };
}

/** The counts sheet: one line per allocated class, seats blank where not known. */
async function countsSheet(filters = {}) {
  const rows = [["train", "train_name", "from", "to", "class", "seats"]];
  for (const p of await everything(filters)) {
    for (const c of p.classes) rows.push([p.train.number, p.train.name, p.from, p.to, c.code, c.seats ?? ""]);
  }
  return toCsv(rows);
}

/** Every allocated pair that matches, however many pages that is. */
async function everything(filters) {
  const out = [];
  for (let page = 1; ; page++) {
    const { items, total } = await list({ ...filters, show: "allocated", page, pageSize: LIST_MAX });
    out.push(...items);
    if (out.length >= total || !items.length) return out;
  }
}

/* ------------------------------------------------------------------ *
 * Uploads — each read first and shown, then applied on a second call
 * ------------------------------------------------------------------ */

const sample = (list, n = 50) => list.slice(0, n);

async function chunked(rows, fn) {
  for (let i = 0; i < rows.length; i += CHUNK) await fn(rows.slice(i, i + CHUNK));
}

/** A file applied goes into the history the page shows. */
const remember = (kind, { fileName, actor, summary, scannedFrom = null, scannedTo = null }, transaction) =>
  AllocationUpload.create(
    {
      kind,
      fileName: fileName ? String(fileName).slice(0, 200) : null,
      summary,
      scannedFrom,
      scannedTo,
      uploadedById: actor?.id ?? null,
    },
    { transaction }
  );

/** The route file: each train's stations in order. Trains not in the file are left alone. */
async function importStops(text, { apply = false, actor, fileName } = {}) {
  const read = readStops(text);
  if (read.error) throw ApiError.badRequest(read.error);
  const d = await dataset();

  const added = [];
  const changed = [];
  let unchanged = 0;
  for (const t of read.trains) {
    const old = d.trains.get(t.number);
    if (!old) added.push(t);
    else if (old.name !== t.name || JSON.stringify(old.stops) !== JSON.stringify(t.stops)) changed.push(t);
    else unchanged++;
  }
  const newStops = new Map(read.trains.map((t) => [t.number, t]));
  const offRoute = d.pairs.filter((p) => {
    const t = newStops.get(p.train);
    if (!t) return false;
    const a = t.stops.indexOf(p.from);
    const b = t.stops.indexOf(p.to);
    return a === -1 || b === -1 || a >= b;
  }).length;

  const preview = {
    kind: "stops",
    trains: read.trains.length,
    added: added.length,
    changed: changed.length,
    unchanged,
    addedTrains: sample(added.map((t) => ({ number: t.number, name: t.name, stops: t.stops.length }))),
    changedTrains: sample(changed.map((t) => ({ number: t.number, name: t.name, stops: t.stops.length }))),
    offRoute,
    skipped: read.skipped,
  };
  if (!apply) return { applied: false, preview };

  const now = new Date();
  const rows = [...added, ...changed].map((t) => ({ number: t.number, name: t.name, stops: t.stops, stopsUpdatedAt: now }));
  await sequelize.transaction(async (transaction) => {
    await chunked(rows, (part) =>
      AllocationTrain.bulkCreate(part, { updateOnDuplicate: ["name", "stops", "stopsUpdatedAt", "updatedAt"], transaction })
    );
    await remember(
      UPLOAD_KINDS.STOPS,
      {
        fileName,
        actor,
        summary: {
          trains: preview.trains,
          added: preview.added,
          changed: preview.changed,
          unchanged: preview.unchanged,
          skipped: preview.skipped.length,
        },
      },
      transaction
    );
  });
  invalidate();
  await audit.record({
    action: AUDIT_ACTIONS.ALLOCATION_IMPORT,
    entity: { type: "allocation", id: "stops", label: "Train routes" },
    after: { kind: "stops", trains: preview.trains, added: preview.added, changed: preview.changed, by: actor?.id ?? null },
    message: `Train routes uploaded: ${preview.added} new, ${preview.changed} changed, ${preview.unchanged} unchanged`,
  });
  return { applied: true, preview };
}

/**
 * The census file. Pairs in the file replace what is stored for them; pairs
 * not in it are left as they are. A class still allocated keeps the count
 * typed in for it; one the railway no longer allocates goes, count and all.
 */
async function importCensus(text, { apply = false, actor, fileName } = {}) {
  const read = readCensus(text);
  if (read.error) throw ApiError.badRequest(read.error);
  const d = await dataset();

  // The same train and pair twice: the later line wins.
  const wanted = new Map();
  for (const e of read.entries) wanted.set(keyOf(e.train.number, e.from, e.to), e);
  const duplicates = read.entries.length - wanted.size;

  const names = new Map();
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  let allocated = 0;
  let classesRemoved = 0;
  let countsLost = 0;
  let offRoute = 0;
  for (const [key, e] of wanted) {
    names.set(e.train.number, e.train.name);
    if (e.status === ALLOCATION_STATUS.ALLOCATED) allocated++;
    if (onRoute(d.trains.get(e.train.number), e.from, e.to) === false) offRoute++;
    const old = d.byKey.get(key);
    if (!old) {
      added++;
      continue;
    }
    const keep = new Set(e.classes);
    const removed = old.classes.filter((c) => !keep.has(c.code));
    const gained = e.classes.filter((code) => !old.classes.some((c) => c.code === code));
    classesRemoved += removed.length;
    countsLost += removed.filter((c) => c.seats !== null).length;
    if (old.status !== e.status || removed.length || gained.length) changed++;
    else unchanged++;
  }
  const newTrains = [...names].filter(([n]) => !d.trains.has(n)).map(([number, name]) => ({ number, name }));
  let scannedFrom = null;
  let scannedTo = null;
  for (const e of wanted.values()) {
    scannedFrom = earlier(scannedFrom, e.checkedAt);
    scannedTo = later(scannedTo, e.checkedAt);
  }

  const preview = {
    kind: "census",
    rows: read.rows,
    pairs: wanted.size,
    added,
    changed,
    unchanged,
    allocated,
    notAllocated: wanted.size - allocated,
    trains: names.size,
    newTrains: sample(newTrains),
    newTrainCount: newTrains.length,
    classesRemoved,
    countsLost,
    offRoute,
    duplicates,
    scannedFrom,
    scannedTo,
    skippedCount: read.skipped.length,
    skipped: read.skipped.slice(0, SKIPPED_SHOWN),
  };
  if (!apply) return { applied: false, preview };
  if (!wanted.size) throw ApiError.badRequest("Nothing in this file can be applied");

  const by = actor?.id ?? null;
  await sequelize.transaction(async (transaction) => {
    if (newTrains.length) {
      await AllocationTrain.bulkCreate(newTrains, { ignoreDuplicates: true, transaction });
    }
    const pairRows = [...wanted.values()].map((e) => ({
      trainNumber: e.train.number,
      fromStation: e.from,
      toStation: e.to,
      status: e.status,
      checkedAt: e.checkedAt,
      source: ALLOCATION_SOURCE.CENSUS,
      updatedById: by,
    }));
    await chunked(pairRows, (part) =>
      AllocationPair.bulkCreate(part, {
        updateOnDuplicate: ["status", "checkedAt", "source", "updatedById", "updatedAt"],
        transaction,
      })
    );

    const ids = new Map(
      (
        await AllocationPair.findAll({
          where: { trainNumber: [...names.keys()] },
          attributes: ["id", "trainNumber", "fromStation", "toStation"],
          raw: true,
          transaction,
        })
      ).map((p) => [keyOf(p.trainNumber, p.fromStation, p.toStation), p.id])
    );

    const drop = [];
    const make = [];
    for (const [key, e] of wanted) {
      const pairId = ids.get(key);
      const old = d.byKey.get(key);
      const keep = new Set(e.classes);
      for (const c of old?.classes || []) if (!keep.has(c.code)) drop.push(c.id);
      for (const code of e.classes) {
        if (!old?.classes.some((c) => c.code === code)) make.push({ pairId, classCode: code, seats: null, updatedById: by });
      }
    }
    await chunked(drop, (part) => AllocationClass.destroy({ where: { id: part }, transaction }));
    await chunked(make, (part) => AllocationClass.bulkCreate(part, { transaction }));
    await remember(
      UPLOAD_KINDS.CENSUS,
      {
        fileName,
        actor,
        scannedFrom,
        scannedTo,
        summary: {
          rows: preview.rows,
          pairs: preview.pairs,
          added,
          changed,
          unchanged,
          allocated,
          notAllocated: preview.notAllocated,
          skipped: preview.skippedCount,
          classesRemoved,
          countsLost,
        },
      },
      transaction
    );
  });
  invalidate();

  await audit.record({
    action: AUDIT_ACTIONS.ALLOCATION_IMPORT,
    entity: { type: "allocation", id: "census", label: "Census" },
    after: {
      kind: "census",
      pairs: preview.pairs,
      added,
      changed,
      unchanged,
      allocated,
      skipped: preview.skippedCount,
      classesRemoved,
      countsLost,
    },
    message: `Census uploaded: ${preview.pairs} train pairs (${added} new, ${changed} changed), ${preview.skippedCount} lines left out`,
  });
  return { applied: true, preview };
}

/** The counts sheet. Only classes already allocated take a count; blank means not known. */
async function importCounts(text, { apply = false, actor, fileName } = {}) {
  const read = readCounts(text);
  if (read.error) throw ApiError.badRequest(read.error);
  const d = await dataset();

  const skipped = [...read.skipped];
  const updates = new Map();
  let unchanged = 0;
  for (const e of read.entries) {
    const pair = d.byKey.get(keyOf(e.train, e.from, e.to));
    const skip = (reason) => skipped.push({ line: e.line, from: e.from, to: e.to, reason });
    if (!pair) {
      skip(`Train ${e.train} has not been checked for this pair`);
      continue;
    }
    if (pair.status !== ALLOCATION_STATUS.ALLOCATED) {
      skip(`Train ${e.train} has no seats allocated for this pair`);
      continue;
    }
    const cls = pair.classes.find((c) => c.code === e.code);
    if (!cls) {
      skip(`Train ${e.train} has no ${e.code} seats allocated for this pair`);
      continue;
    }
    if (cls.seats === e.seats && !updates.has(cls.id)) {
      unchanged++;
      continue;
    }
    updates.set(cls.id, { id: cls.id, pairId: pair.id, classCode: cls.code, seats: e.seats, before: cls.seats });
  }
  const changes = [...updates.values()].filter((u) => u.seats !== u.before);
  unchanged += updates.size - changes.length;
  skipped.sort((a, b) => a.line - b.line);

  const preview = {
    kind: "counts",
    rows: read.rows,
    set: changes.filter((u) => u.seats !== null).length,
    cleared: changes.filter((u) => u.seats === null).length,
    unchanged,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, SKIPPED_SHOWN),
  };
  if (!apply) return { applied: false, preview };

  const by = actor?.id ?? null;
  const now = new Date();
  await sequelize.transaction(async (transaction) => {
    await chunked(changes, (part) =>
      AllocationClass.bulkCreate(
        part.map((u) => ({
          id: u.id,
          pairId: u.pairId,
          classCode: u.classCode,
          seats: u.seats,
          updatedById: by,
          seatsUpdatedAt: now,
          seatsUpdatedById: by,
        })),
        { updateOnDuplicate: ["seats", "updatedById", "seatsUpdatedAt", "seatsUpdatedById", "updatedAt"], transaction }
      )
    );
    await remember(
      UPLOAD_KINDS.COUNTS,
      {
        fileName,
        actor,
        summary: { rows: preview.rows, set: preview.set, cleared: preview.cleared, unchanged: preview.unchanged, skipped: preview.skippedCount },
      },
      transaction
    );
  });
  invalidate();
  await audit.record({
    action: AUDIT_ACTIONS.ALLOCATION_IMPORT,
    entity: { type: "allocation", id: "counts", label: "Seat counts" },
    after: { kind: "counts", set: preview.set, cleared: preview.cleared, skipped: preview.skippedCount },
    message: `Seat counts uploaded: ${preview.set} set, ${preview.cleared} cleared, ${preview.skippedCount} lines left out`,
  });
  return { applied: true, preview };
}

/* ------------------------------------------------------------------ *
 * One pair, by hand
 * ------------------------------------------------------------------ */

async function pairAt(d, train, from, to) {
  const t = d.trains.get(Number(train));
  if (!t) throw ApiError.notFound("There is no such train in the allocation data");
  if (onRoute(t, from, to) === false) {
    throw ApiError.badRequest(`${from} and ${to} are not on ${t.name}'s route in that order`);
  }
  return t;
}

const view = (p) => p && { status: p.status, classes: p.classes.map((c) => ({ code: c.code, seats: c.seats })) };

/**
 * Set a pair as allocated, with its classes and counts, or as not allocated.
 *
 * Typing in counts is not checking the allocation again: a pair whose status
 * and classes stay as they were keeps where they came from — the census, and
 * when it was scanned. Only a change to either marks it set by hand, now. A
 * save that changes nothing changes nothing, and records nothing.
 */
async function savePair({ train, from, to, status, classes = [] }, actor) {
  const d = await dataset();
  const t = await pairAt(d, train, from, to);
  if (!Object.values(ALLOCATION_STATUS).includes(status)) {
    throw ApiError.badRequest("status must be allocated or not_allocated");
  }
  const wanted = status === ALLOCATION_STATUS.ALLOCATED ? classes : [];
  const codes = new Set();
  for (const c of wanted) {
    const code = String(c?.code || "").trim().toUpperCase();
    if (!CLASS_CODE.test(code)) throw ApiError.badRequest(`Not a class code: ${c?.code}`);
    if (codes.has(code)) throw ApiError.badRequest(`${code} is listed twice`);
    codes.add(code);
    const seats = c.seats;
    if (seats !== null && seats !== undefined && !(Number.isInteger(seats) && seats >= 0 && seats <= MAX_SEATS)) {
      throw ApiError.badRequest(`Seats must be a whole number from 0 to ${MAX_SEATS}, or empty when not known`);
    }
  }

  const key = keyOf(t.number, from, to);
  const existing = d.byKey.get(key);
  const before = view(existing) || null;
  const by = actor?.id ?? null;
  const next = new Map(wanted.map((c) => [String(c.code).trim().toUpperCase(), c.seats ?? null]));
  const sameClasses =
    existing && existing.classes.length === next.size && existing.classes.every((c) => next.has(c.code));
  const recheck = !existing || existing.status !== status || !sameClasses;
  const sameCounts = existing && existing.classes.every((c) => next.get(c.code) === c.seats);
  if (!recheck && sameCounts) return present(d, existing);

  await sequelize.transaction(async (transaction) => {
    const stamp = { status, checkedAt: new Date(), source: ALLOCATION_SOURCE.MANUAL, updatedById: by };
    const [pair, made] = await AllocationPair.findOrCreate({
      where: { trainNumber: t.number, fromStation: from, toStation: to },
      defaults: stamp,
      transaction,
    });
    if (!made && recheck) await pair.update(stamp, { transaction });
    const old = await AllocationClass.findAll({ where: { pairId: pair.id }, transaction });
    for (const row of old) {
      if (!next.has(row.classCode)) await row.destroy({ transaction });
      else if (row.seats !== next.get(row.classCode)) {
        await row.update(
          { seats: next.get(row.classCode), updatedById: by, seatsUpdatedAt: new Date(), seatsUpdatedById: by },
          { transaction }
        );
      }
    }
    const have = new Set(old.map((r) => r.classCode));
    const make = [...next]
      .filter(([code]) => !have.has(code))
      .map(([classCode, seats]) => ({
        pairId: pair.id,
        classCode,
        seats,
        updatedById: by,
        seatsUpdatedAt: seats === null ? null : new Date(),
        seatsUpdatedById: seats === null ? null : by,
      }));
    if (make.length) await AllocationClass.bulkCreate(make, { transaction });
  });
  invalidate();

  const after = (await dataset()).byKey.get(key);
  await audit.record({
    action: AUDIT_ACTIONS.ALLOCATION_EDIT,
    entity: { type: "allocation", id: key, label: `${t.name} (${t.number}) ${from} → ${to}` },
    before,
    after: view(after),
  });
  return present(await dataset(), after);
}

/** Forget a pair: it goes back to not checked. */
async function clearPair({ train, from, to }) {
  const d = await dataset();
  const t = d.trains.get(Number(train));
  const key = keyOf(Number(train), from, to);
  const old = d.byKey.get(key);
  if (!t || !old) throw ApiError.notFound("That pair has not been checked");
  await AllocationPair.destroy({ where: { id: old.id } });
  invalidate();
  await audit.record({
    action: AUDIT_ACTIONS.ALLOCATION_CLEAR,
    entity: { type: "allocation", id: key, label: `${t.name} (${t.number}) ${from} → ${to}` },
    before: view(old),
  });
}

module.exports = {
  NOT_CHECKED,
  meta,
  uploads,
  list,
  countsSheet,
  importStops,
  importCensus,
  importCounts,
  savePair,
  clearPair,
  invalidate,
};
