// Seat plan templates, and what saving a plan that clashes with another can
// do: a clash names the plan in the way; plans move to templates (one or
// several) and back; a template never clashes and is never used by trains,
// departures or approval; a plan's train or coach is changed to make room;
// an approved plan's layout is replaced through approval, the old one kept
// as a template.
const BACKEND = require("path").resolve(__dirname, "../../..");
const { SeatPlan, TrainCoach, TripCoach } = require(`${BACKEND}/src/models`);

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
const message = (r) => r.body?.error?.message || "";
const code = (r) => r.body?.error?.code;

const row = (n) => ({ id: `r${n}`, cells: [1, 2].map((k) => ({ kind: "seat", id: `s${n}${k}`, number: String(n * 2 + k - 2) })) });
const layout = (rows) => ({ rows: Array.from({ length: rows }, (_, i) => row(i + 1)) });

(async () => {
  const st = await login("unittest-super1@example.com"); // approves
  const pt = await login("unittest-planner@example.com"); // draws, cannot approve

  // An approved plan a train's coaches use.
  const inUse = await TrainCoach.findOne({
    include: [{ model: SeatPlan, as: "seatPlan", required: true, where: { status: "approved", revisionOfId: null } }],
    order: [["id", "ASC"]],
  });
  const P = inUse.seatPlan;
  const T = P.trainNameId;
  const create = (token, body) =>
    call("POST", "/plans", {
      token,
      body: { trainNameId: T, coachTypeId: P.coachTypeId, coachClassId: P.coachClassId, layout: layout(2), ...body },
    });

  console.log("== a clash names the plan in the way ==");
  const d1 = (await create(pt, { coachNo: "ZT1" })).body.plan;
  check("a draft for a free coach", d1?.id && d1.isTemplate === false, JSON.stringify(d1));
  const clash = await create(pt, { coachNo: "ZT1" });
  check("a second for the same train and coach is refused", clash.status === 409 && code(clash) === "PLAN_COACH_TAKEN", say(clash));
  check("naming the plan in the way", clash.body.error.details?.plan?.id === d1.id && clash.body.error.details.plan.status === "draft" &&
    Array.isArray(clash.body.error.details.usedBy), say(clash));
  const used = await create(pt, { coachNo: P.coachNo });
  check("and the trains whose coaches use it", used.status === 409 && used.body.error.details?.usedBy?.length >= 1, say(used));
  const tpl = await create(pt, { coachNo: "ZT1", isTemplate: true });
  check("a template for the same train and coach clashes with nothing", tpl.status === 201 && tpl.body.plan.isTemplate === true, say(tpl));

  console.log("\n== moved to templates, and back ==");
  const moved = await call("POST", "/plans/templates", { token: pt, body: { ids: [d1.id] } });
  check("a draft moved to templates", moved.status === 200 && moved.body.results[0]?.ok === true, say(moved));
  const d2 = await create(pt, { coachNo: "ZT1" });
  check("its train and coach free for a new plan", d2.status === 201, say(d2));
  const plans = (await call("GET", "/plans", { token: st })).body.plans;
  const templates = (await call("GET", "/plans?kind=templates", { token: st })).body.plans;
  const startFrom = (await call("GET", "/plans?templates=1", { token: pt })).body.plans;
  check("listed among the templates, not the plans", templates.some((p) => p.id === d1.id) && !plans.some((p) => p.id === d1.id));
  check("and offered to start a new plan from", startFrom.some((p) => p.id === d1.id));

  const refusedInUse = await call("POST", "/plans/templates", { token: st, body: { ids: [P.id] } });
  check("a plan a train's coaches use is refused, naming the train", refusedInUse.body.results[0]?.ok === false &&
    /among (its|their) coaches/.test(refusedInUse.body.results[0].reason), say(refusedInUse));

  const a = (await create(st, { coachNo: "ZT2" })).body.plan;
  await call("POST", `/plans/${a.id}/submit`, { token: st });
  check("(an approved plan no train uses)", (await call("GET", `/plans/${a.id}`, { token: st })).body.plan.status === "approved");
  const noRight = await call("POST", "/plans/templates", { token: pt, body: { ids: [a.id] } });
  check("taking it out of use needs the right to approve", noRight.body.results[0]?.ok === false && /approve/.test(noRight.body.results[0].reason), say(noRight));
  check("which the super admin has", (await call("POST", "/plans/templates", { token: st, body: { ids: [a.id] } })).body.results[0]?.ok === true);

  const bulk = await call("POST", "/plans/templates", { token: pt, body: { ids: [d2.body.plan.id, P.id, 999999] } });
  const res = (id) => bulk.body.results.find((r) => r.id === id);
  check("several at once, each on its own", res(d2.body.plan.id)?.ok === true && res(P.id)?.ok === false && /not found/i.test(res(999999)?.reason || ""),
    say(bulk));

  const editTemplate = await call("PUT", `/plans/${a.id}`, { token: pt, body: { layout: layout(3) } });
  check("a template is changed as it is, even one that was approved", editTemplate.status === 200 && editTemplate.body.plan.layout.rows.length === 3,
    say(editTemplate));
  check("never submitted", /never submitted/.test(message(await call("POST", `/plans/${a.id}/submit`, { token: st }))));
  check("nor changed through a copy", (await call("POST", `/plans/${a.id}/revise`, { token: st })).status === 400);

  const back = await call("POST", `/plans/${d1.id}/restore`, { token: pt });
  check("back to plans, its coach being free", back.status === 200 && back.body.plan.isTemplate === false, say(back));
  const blocked = await call("POST", `/plans/${d2.body.plan.id}/restore`, { token: pt });
  check("not while another plan has its coach", blocked.status === 409 && code(blocked) === "PLAN_COACH_TAKEN", say(blocked));
  check("an approved one back into use needs the right to approve", (await call("POST", `/plans/${a.id}/restore`, { token: pt })).status === 403);

  console.log("\n== never used by trains or departures ==");
  const lineUp = (await call("GET", `/trains/${inUse.trainId}/composition`, { token: st })).body.coaches;
  const withTemplate = [...lineUp.map((c) => ({ coachCode: c.coachCode, seatPlanId: c.seatPlanId })), { coachCode: "ZZ", seatPlanId: a.id }];
  const setLine = await call("PUT", `/trains/${inUse.trainId}/composition`, { token: st, body: { coaches: withTemplate } });
  check("not in a train's coaches", setLine.status === 400 && /template/.test(message(setLine)), say(setLine));
  const trip = await TripCoach.findOne({ order: [["id", "DESC"]] });
  const addCoach = await call("POST", `/trips/${trip.tripId}/coaches`, { token: st, body: { seatPlanId: a.id, coachCode: "ZZ" } });
  check("not added to a departure", addCoach.status >= 400 && (/template/.test(message(addCoach)) || addCoach.status === 409), say(addCoach));
  check("not seen by passengers", (await call("GET", `/plans/${a.id}`, { token: await login("unittest-user@example.com") })).status === 404);

  console.log("\n== another plan's details, changed to make room ==");
  const renamed = await call("POST", `/plans/${d1.id}/details`, { token: pt, body: { coachNo: "ZT1B" } });
  check("a draft's coach changed", renamed.status === 200 && renamed.body.plan.coachNo === "ZT1B", say(renamed));
  check("to one that is taken: refused", (await call("POST", `/plans/${d1.id}/details`, { token: pt, body: { coachNo: P.coachNo, trainNameId: T } })).status === 409);
  check("a plan in use: needs the right to approve", (await call("POST", `/plans/${P.id}/details`, { token: pt, body: { coachNo: "ZT9" } })).status === 403);
  const real = await call("POST", `/plans/${P.id}/details`, { token: st, body: { coachNo: "ZT9" } });
  check("which changes it, the train keeping it", real.status === 200 && (await TrainCoach.count({ where: { seatPlanId: P.id } })) >= 1, say(real));
  await call("POST", `/plans/${P.id}/details`, { token: st, body: { coachNo: P.coachNo } });

  console.log("\n== a plan in use, replaced through approval ==");
  const L2 = layout(4);
  const replaced = await call("POST", `/plans/${P.id}/replace`, { token: pt, body: { layout: L2 } });
  const copy = replaced.body?.plan;
  check("the new layout becomes its editable copy", replaced.status === 201 && copy?.revisionOfId === P.id && copy.status === "draft", say(replaced));
  const kept = await SeatPlan.findByPk(replaced.body?.templateId);
  check("the one in use kept as a template", kept?.isTemplate === true && kept.coachNo === P.coachNo &&
    JSON.stringify(kept.layout) === JSON.stringify((await SeatPlan.findByPk(P.id)).layout));
  check("the plan still in use meanwhile", (await call("GET", `/plans/${P.id}`, { token: st })).body.plan.status === "approved");
  check("twice: refused, the changes are waiting", (await call("POST", `/plans/${P.id}/replace`, { token: pt, body: { layout: L2 } })).status === 409);
  const approved = await call("POST", `/plans/${copy.id}/submit`, { token: st });
  const after = (await call("GET", `/plans/${P.id}`, { token: st })).body.plan;
  check("approved: the plan has the new layout, under its own id", approved.status === 200 && after.layout.rows.length === 4 &&
    (await TrainCoach.count({ where: { seatPlanId: P.id } })) >= 1, say(approved));

  const d3 = (await call("POST", "/plans", { token: pt, body: { layout: layout(5) } })).body.plan;
  const withDraft = await call("POST", `/plans/${P.id}/replace`, { token: pt, body: { layout: layout(5), planId: d3.id } });
  check("a draft already saved becomes the copy itself", withDraft.status === 201 && withDraft.body.plan.id === d3.id &&
    withDraft.body.plan.revisionOfId === P.id, say(withDraft));
  check("only an approved plan is replaced so", (await call("POST", `/plans/${d1.id}/replace`, { token: pt, body: { layout: L2 } })).status === 400);

  console.log("\n== in the audit log, when there is one ==");
  const logged = (await call("GET", "/audit?action=plan.template&limit=5", { token: st })).body;
  if (logged?.available === false) console.log("  (no document store here — skipped)");
  else {
    check("moved to templates: recorded", (logged?.pagination?.total || 0) >= 3, JSON.stringify(logged?.pagination));
    check("replaced: recorded", ((await call("GET", "/audit?action=plan.replace", { token: st })).body.pagination?.total || 0) >= 2);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
