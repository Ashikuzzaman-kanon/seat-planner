const test = require("node:test");
const assert = require("node:assert/strict");

const { DIMENSIONS, readAsk, groupsSql, searchOf, queryKeyOf } = require("../../src/services/allocationRequestService");
const { todayInDhaka, addDays } = require("../../src/utils/dhakaTime");

test("by default: public page or app, over the last 30 days, searches only", () => {
  const ask = readAsk({});
  assert.deepEqual(ask.by, ["channel"]);
  assert.equal(ask.until, todayInDhaka());
  assert.equal(ask.since, addDays(todayInDhaka(), -29));
  assert.equal(ask.days, 30);
  assert.equal(ask.all, false);
  assert.deepEqual(ask.where, []);
});

test("filters: field:value, the value taken whole; field: alone is none", () => {
  const ask = readAsk({ by: "train,outcome", w: ["train:705", "person:", "site:example.com:8080"], all: "1" });
  assert.deepEqual(ask.by, ["train", "outcome"]);
  assert.deepEqual(ask.where, [
    { key: "train", value: "705" },
    { key: "person", value: null },
    { key: "site", value: "example.com:8080" },
  ]);
  assert.equal(ask.all, true);
  assert.deepEqual(readAsk({ w: "channel:app" }).where, [{ key: "channel", value: "app" }]);
});

test("anything else is refused, saying what is wanted", () => {
  const refused = (q) => assert.throws(() => readAsk(q), (e) => e.statusCode === 400);
  refused({ by: "nope" });
  refused({ by: "train,outcome,day" });
  refused({ by: "train,train" });
  refused({ w: "nope:1" });
  refused({ w: "train" });
  refused({ since: "2026-10-23", until: "2026-10-01" });
  refused({ since: "2024-01-01", until: "2026-10-01" });
  refused({ since: "23-10-2026" });
  refused({ w: Array.from({ length: 13 }, (_, i) => `train:${i}`) });
});

test("every field has a group, a name and SQL", () => {
  for (const [key, d] of Object.entries(DIMENSIONS)) {
    assert.ok(d.group && d.label, key);
    assert.equal(typeof d.sql("v"), "string", key);
  }
});

test("what a caller sends never becomes SQL: values go as replacements", () => {
  const sneaky = "x' OR 1=1 -- ";
  const { sql, replacements } = groupsSql(readAsk({ by: "train", w: [`from:${sneaky}`, `role:${sneaky}`, `station:${sneaky}`] }));
  assert.ok(!sql.includes(sneaky));
  assert.deepEqual(Object.values(replacements).filter((v) => v === sneaky).length, 3);
});

test("by station, a search counts at both ends; by role, through the person's roles", () => {
  const station = groupsSql(readAsk({ by: "station" })).sql;
  assert.match(station, /UNION ALL/);
  assert.match(station, /v\.station AS g0/);
  const role = groupsSql(readAsk({ by: "role,channel" })).sql;
  assert.match(role, /LEFT JOIN user_roles ur ON ur\.user_id = v\.user_id/);
  assert.match(role, /GROUP BY g0, g1/);
  // Searches only, unless every request is asked for — or the request type is filtered.
  assert.match(groupsSql(readAsk({})).sql, /AND v\.kind = 'list'/);
  assert.doesNotMatch(groupsSql(readAsk({ all: "1" })).sql, /AND v\.kind = 'list'/);
  assert.doesNotMatch(groupsSql(readAsk({ w: "kind:meta" })).sql, /AND v\.kind = 'list'/);
});

test("a search, recorded the same way on the public page and in the app", () => {
  assert.deepEqual(searchOf({ from: "Dhaka", to: "Rajshahi", train: "753", classCode: "S_CHAIR", page: "2" }), {
    from: "Dhaka",
    to: "Rajshahi",
    train: 753,
    class: "S_CHAIR",
    show: "allocated",
    page: 2,
  });
  assert.equal(queryKeyOf({ from: "Dhaka", show: "all", page: 3 }), "Dhaka||||all");
  assert.equal(queryKeyOf({}), "||||");
});
