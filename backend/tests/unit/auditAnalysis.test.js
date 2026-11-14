const test = require("node:test");
const assert = require("node:assert/strict");

const { DIMENSIONS, readAsk, matchOf, groupsPipeline, bucketsOf } = require("../../src/services/auditAnalysisService");
const { todayInDhaka, addDays } = require("../../src/utils/dhakaTime");

test("by default: by operation, the last 30 days, test accounts left out", () => {
  const ask = readAsk({});
  assert.deepEqual(ask.by, ["action"]);
  assert.equal(ask.span.until, todayInDhaka());
  assert.equal(ask.span.since, addDays(todayInDhaka(), -29));
  assert.equal(ask.span.days, 30);
  assert.equal(ask.tests, false);
  assert.equal(ask.hours, null);
  assert.equal(ask.days, null);
  assert.equal(ask.compare, false);
});

test("lists come repeated or comma-separated; no one signed in is person none", () => {
  const ask = readAsk({ action: ["auth.login", "role.create,role.delete"], area: "subscription", person: ["4", "none"], outcome: "failure" });
  assert.deepEqual(ask.actions, ["auth.login", "role.create", "role.delete"]);
  assert.deepEqual(ask.areas, ["subscription"]);
  assert.deepEqual(ask.people, [4, null]);
  assert.equal(ask.outcome, "failure");
});

test("hours of the day: a span, past midnight too; the whole day is no filter", () => {
  assert.deepEqual(readAsk({ hours: "9-13" }).hours, [9, 10, 11, 12]);
  assert.deepEqual(readAsk({ hours: "22-3" }).hours, [22, 23, 0, 1, 2]);
  assert.equal(readAsk({ hours: "0-24" }).hours, null);
  assert.deepEqual(readAsk({ days: "6,7" }).days, [6, 7]);
  assert.equal(readAsk({ days: "1,2,3,4,5,6,7" }).days, null);
});

test("the last hour, in five-minute steps on Dhaka's clock", () => {
  const ask = readAsk({ last: "60" });
  assert.equal(ask.span.last, 60);
  assert.ok(Math.abs(ask.span.end - ask.span.start - 3_600_000) < 1000);
  const buckets = bucketsOf(ask.span, "5min");
  assert.ok(buckets.length === 12 || buckets.length === 13, `${buckets.length}`);
  assert.match(buckets[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d[05]$/);
});

test("weeks start on Saturday", () => {
  const ask = readAsk({ since: "2026-01-01", until: "2026-06-30" });
  const weeks = bucketsOf(ask.span, "week");
  assert.equal(weeks[0], "2025-12-27"); // the Saturday before Thursday 1 January
  assert.equal(new Date(`${weeks[1]}T12:00:00Z`).getUTCDay(), 6);
});

test("anything else is refused, saying what is wanted", () => {
  const refused = (q) => assert.throws(() => readAsk(q), (e) => e.statusCode === 400, JSON.stringify(q));
  refused({ action: "$where" });
  refused({ action: "auth login" });
  refused({ area: "auth.login" });
  refused({ person: "someone" });
  refused({ outcome: "maybe" });
  refused({ by: "action,person,hour" });
  refused({ by: "nope" });
  refused({ w: "nope:1" });
  refused({ since: "2026-10-23", until: "2026-10-01" });
  refused({ last: "3" });
  refused({ hours: "9-9" });
  refused({ hours: "25-3" });
  refused({ days: "0" });
  refused({ person: "1,2,3,4,5,6", compare: "1" });
});

test("what is picked: chosen operations or whole groups, people, no test accounts", () => {
  const { $and } = matchOf(readAsk({ action: "auth.login", area: "subscription", person: "none", outcome: "success" }));
  assert.deepEqual($and[1], { $or: [{ action: { $in: ["auth.login"] } }, { action: { $regex: "^(subscription)\\." } }] });
  assert.deepEqual($and[2], { $or: [{ "actor.id": null }] });
  assert.deepEqual($and[3], { outcome: "success" });
  assert.ok($and.some((c) => c["actor.email"]?.$not instanceof RegExp));
  assert.ok(!matchOf(readAsk({ tests: "1" })).$and.some((c) => c["actor.email"]));
});

test("a filter's value goes in as a value, typed as the field's", () => {
  const { $and } = matchOf(readAsk({ w: ["hour:9", "person:", "action:a.b,c"] }));
  const [hour, person, action] = $and.slice(-3);
  assert.equal(hour.$expr.$eq[1], 9);
  assert.equal(person.$expr.$eq[1], null);
  assert.equal(action.$expr.$eq[1], "a.b,c");
});

test("by role, each role an event's person held; names kept with people and targets", () => {
  const byRole = groupsPipeline(readAsk({ by: "role,outcome" }));
  assert.ok(byRole.some((s) => s.$unwind?.path === "$actor.roles"));
  const byPerson = groupsPipeline(readAsk({ by: "person,target" }));
  const group = byPerson.find((s) => s.$group).$group;
  assert.deepEqual(Object.keys(group._id), ["g0", "g1"]);
  assert.ok(group.x0 && group.x1);
});

test("every field has a group, a name and an expression", () => {
  for (const [key, d] of Object.entries(DIMENSIONS)) {
    assert.ok(d.group && d.label && d.expr, key);
  }
});
