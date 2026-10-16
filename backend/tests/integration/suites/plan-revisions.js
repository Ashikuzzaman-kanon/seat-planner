// Changing an approved seat plan through an editable copy: the plan keeps
// being used until the copy is approved, then takes the copy's content under
// its own id. And a train has one plan per coach number.
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, SeatPlan, TrainCoach, TripCoach, TripSeat } = require(`${BACKEND}/src/models`);

const BASE = process.env.API_BASE;
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body.accessToken;
const message = (r) => r.body?.error?.message || r.body?.message || "";

(async () => {
  const st = await login("unittest-super1@example.com"); // approves
  const pt = await login("unittest-planner@example.com"); // edits, cannot approve

  // An approved plan a train's line-up uses, with a departure already built from it.
  const inUse = await TripCoach.findOne({
    include: [{ model: SeatPlan, as: "seatPlan", required: true, where: { status: "approved", revisionOfId: null } }],
    order: [["id", "ASC"]],
  });
  const P = inUse.seatPlan;
  const seatsBefore = await TripSeat.count({ where: { tripCoachId: inUse.id } });
  const lineUp = await TrainCoach.count({ where: { seatPlanId: P.id } });
  console.log(`== an approved plan in use: #${P.id} (${P.coachNo}), on ${lineUp} line-up coach(es) ==`);

  const direct = await call("PUT", `/plans/${P.id}`, { token: pt, body: { coachNo: P.coachNo } });
  check("it cannot be edited directly", direct.status === 409 && /editable copy/.test(message(direct)), say(direct));

  console.log("\n== opening a copy ==");
  const opened = await call("POST", `/plans/${P.id}/revise`, { token: pt });
  const copy = opened.body?.plan;
  check("Edit opens an editable copy", opened.status === 201 && copy?.revisionOfId === P.id && copy.status === "draft", say(opened));
  check("with the plan's train, coach, class, type and layout",
    copy.trainNameId === P.trainNameId && copy.coachNo === P.coachNo && copy.coachClassId === P.coachClassId &&
      copy.coachTypeId === P.coachTypeId && JSON.stringify(copy.layout) === JSON.stringify((await call("GET", `/plans/${P.id}`, { token: st })).body.plan.layout));
  const again = await call("POST", `/plans/${P.id}/revise`, { token: st });
  check("pressing Edit again opens the same copy, for anyone", again.status === 200 && again.body.plan.id === copy.id, say(again));
  check("the plan says it has one", (await call("GET", `/plans/${P.id}`, { token: st })).body.plan.revision?.id === copy.id);
  check("a copy is not copied", (await call("POST", `/plans/${copy.id}/revise`, { token: pt })).status === 400);
  const templates = (await call("GET", "/plans?templates=1", { token: pt })).body.plans;
  check("and is not offered as a template", !templates.some((p) => p.id === copy.id));
  const someone = await call("GET", "/plans?status=draft", { token: st });
  check("it is listed, marked as a copy", someone.body.plans.some((p) => p.id === copy.id && p.revisionOfId === P.id));

  console.log("\n== changing the copy, while the plan keeps working ==");
  const changedLayout = { ...copy.layout, rows: copy.layout.rows.slice(0, -1) };
  const saved = await call("PUT", `/plans/${copy.id}`, { token: pt, body: { layout: changedLayout } });
  check("the copy takes changes", saved.status === 200 && saved.body.plan.layout.rows.length === copy.layout.rows.length - 1, say(saved));
  const meanwhile = (await call("GET", `/plans/${P.id}`, { token: st })).body.plan;
  check("the plan itself is still approved, with its old layout",
    meanwhile.status === "approved" && meanwhile.layout.rows.length === copy.layout.rows.length, JSON.stringify({ status: meanwhile.status }));
  const submitted = await call("POST", `/plans/${copy.id}/submit`, { token: pt });
  check("a planner's copy goes to the approval queue", submitted.status === 200 && submitted.body.plan.status === "pending", say(submitted));
  const queue = (await call("GET", "/plans?status=pending", { token: st })).body.plans;
  check("where it shows as changes to an approved plan", queue.some((p) => p.id === copy.id && p.revisionOfId === P.id));
  check("and the plan is still the one in service", (await call("GET", `/plans/${P.id}`, { token: st })).body.plan.status === "approved");

  console.log("\n== approving the copy ==");
  const approved = await call("POST", `/plans/${copy.id}/approve`, { token: st });
  check("approving answers with the plan, under its own id", approved.status === 200 && approved.body.plan.id === P.id, say(approved));
  const after = (await call("GET", `/plans/${P.id}`, { token: st })).body.plan;
  check("which now has the copy's layout", after.layout.rows.length === copy.layout.rows.length - 1 && after.status === "approved");
  check("and no copy", after.revision === null);
  check("the copy is gone", (await call("GET", `/plans/${copy.id}`, { token: st })).status === 404);
  check("the line-up still points at the plan", (await TrainCoach.count({ where: { seatPlanId: P.id } })) === lineUp);
  check("and the departure already built keeps its seats", (await TripSeat.count({ where: { tripCoachId: inUse.id } })) === seatsBefore);

  console.log("\n== sent back, and thrown away ==");
  const second = (await call("POST", `/plans/${P.id}/revise`, { token: pt })).body.plan;
  await call("POST", `/plans/${second.id}/submit`, { token: pt });
  const rejected = await call("POST", `/plans/${second.id}/reject`, { token: st, body: { reason: "Seat 12 is in the wrong place" } });
  check("a copy can be sent back like any plan", rejected.status === 200 && rejected.body.plan.status === "rejected", say(rejected));
  check("leaving the plan as it was", (await call("GET", `/plans/${P.id}`, { token: st })).body.plan.layout.rows.length === after.layout.rows.length);
  const discarded = await call("DELETE", `/plans/${second.id}`, { token: pt });
  check("deleting the copy throws the changes away", discarded.status === 200 && (await call("GET", `/plans/${P.id}`, { token: st })).body.plan.revision === null, say(discarded));

  console.log("\n== an approver's own copy ==");
  const third = (await call("POST", `/plans/${P.id}/revise`, { token: st })).body.plan;
  await call("PUT", `/plans/${third.id}`, { token: st, body: { layout: copy.layout } });
  const straight = await call("POST", `/plans/${third.id}/submit`, { token: st });
  check("is approved as it is submitted, straight into the plan",
    straight.status === 200 && straight.body.plan.id === P.id && straight.body.plan.layout.rows.length === copy.layout.rows.length, say(straight));
  check("and goes", (await SeatPlan.count({ where: { revisionOfId: P.id } })) === 0);

  console.log("\n== one plan per coach of a train ==");
  const twin = await call("POST", "/plans", {
    token: pt,
    body: { coachNo: P.coachNo, trainNameId: P.trainNameId, coachTypeId: P.coachTypeId, coachClassId: P.coachClassId, layout: copy.layout },
  });
  check("a second plan for the same train and coach is refused", twin.status === 409 && /already has a seat plan for coach/.test(message(twin)), say(twin));
  const draft = (await call("POST", "/plans", { token: pt, body: { coachNo: "ZZ-TEST", trainNameId: P.trainNameId, layout: copy.layout } })).body.plan;
  const clash = await call("PUT", `/plans/${draft.id}`, { token: pt, body: { coachNo: P.coachNo } });
  check("and so is renaming one to it", clash.status === 409, say(clash));
  check("the same coach number on another train is fine",
    (await call("PUT", `/plans/${draft.id}`, { token: pt, body: { coachNo: P.coachNo, trainNameId: null } })).status === 200);

  console.log("\n== a copy goes with its plan ==");
  const lone = (await call("POST", "/plans", { token: st, body: { coachNo: "ZZ-LONE", trainNameId: P.trainNameId, coachTypeId: P.coachTypeId, coachClassId: P.coachClassId, layout: copy.layout } })).body.plan;
  await call("POST", `/plans/${lone.id}/submit`, { token: st });
  const loneCopy = (await call("POST", `/plans/${lone.id}/revise`, { token: st })).body.plan;
  check("deleting a plan deletes its open copy",
    (await call("DELETE", `/plans/${lone.id}`, { token: st })).status === 200 && (await call("GET", `/plans/${loneCopy.id}`, { token: st })).status === 404);
  check("a plan that is not approved is edited as it is", (await call("POST", `/plans/${draft.id}/revise`, { token: pt })).status === 400);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
