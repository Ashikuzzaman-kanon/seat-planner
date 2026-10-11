// In-app notifications: what lands in whose inbox when things happen, and the
// inbox itself — paging, reading, dismissing — always one's own.
const BASE = process.env.API_BASE;

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

const login = async (email) =>
  (await call("POST", "/auth/login", { body: { email, password: "UnitTest123!" } })).body;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** The newest notifications of one type in someone's inbox. */
async function inboxOf(token, type) {
  const list = (await call("GET", "/notifications?limit=50", { token })).body.notifications;
  return type ? list.filter((n) => n.type === type) : list;
}

async function finished(jobId, token) {
  for (let i = 0; i < 240; i++) {
    const job = (await call("GET", `/jobs/${jobId}`, { token })).body?.job;
    if (job && ["succeeded", "failed"].includes(job.status)) return job;
    await pause(500);
  }
  return null;
}

(async () => {
  const su = await login("unittest-super1@example.com");
  const admin = await login("unittest-admin@example.com");
  const planner = await login("unittest-planner@example.com");
  const user = await login("unittest-user@example.com");
  const target = await login("unittest-target@example.com");
  const [st, at, pt, ut, tt] = [su, admin, planner, user, target].map((x) => x.accessToken);

  console.log("== everyone has an inbox ==");
  const empty = await call("GET", "/notifications/summary", { token: tt });
  check("the summary answers for any signed-in account", empty.status === 200, JSON.stringify(empty.body));
  check("with a count and the newest id", Number.isInteger(empty.body.unreadCount) && Number.isInteger(empty.body.latestId));
  check("but not for nobody", (await call("GET", "/notifications/summary")).status === 401);

  console.log("\n== a change of roles reaches the account ==");
  const roles = (await call("GET", "/roles", { token: st })).body.roles;
  const roleId = (name) => roles.find((r) => r.name === name).id;
  await call("PUT", `/users/${target.user.id}/roles`, { token: st, body: { roleIds: [roleId("user"), roleId("planner")] } });
  await pause(300);
  const [changed] = await inboxOf(tt, "account.roles_changed");
  check("a notification arrives", !!changed, JSON.stringify(await inboxOf(tt)));
  check("saying what was added and by whom", /Added: Planner/.test(changed?.body) && /Changed by/.test(changed?.body), changed?.body);
  check("unread, in the account category", changed && !changed.read && changed.category === "account");
  const after = (await call("GET", "/notifications/summary", { token: tt })).body;
  check("the count went up", after.unreadCount > empty.body.unreadCount && after.latestId > empty.body.latestId);
  await call("PUT", `/users/${target.user.id}/roles`, { token: st, body: { roleIds: [roleId("user")] } });

  console.log("\n== a seat plan on its way through approval ==");
  const approved = (await call("GET", "/plans?status=approved", { token: pt })).body.plans[0];
  const source = (await call("GET", `/plans/${approved.id}`, { token: pt })).body.plan;
  const create = (coachNo) =>
    call("POST", "/plans", {
      token: pt,
      body: {
        coachNo,
        trainNameId: source.trainNameId,
        coachTypeId: source.coachTypeId,
        coachClassId: source.coachClassId,
        layout: source.layout,
      },
    });
  const planA = (await create("NOTIFY-A")).body.plan;
  const submitted = await call("POST", `/plans/${planA.id}/submit`, { token: pt });
  check("a planner's plan goes to pending", submitted.body?.plan?.status === "pending", JSON.stringify(submitted.body));
  await pause(300);
  const waiting = (await inboxOf(at, "plan.submitted")).find((n) => n.title.includes("NOTIFY-A"));
  check("an approver is told it is waiting", !!waiting, JSON.stringify((await inboxOf(at)).slice(0, 3)));
  check("with a link to Approvals", waiting?.link === "/dashboard/approvals", waiting?.link);
  check("so is a super admin", (await inboxOf(st, "plan.submitted")).some((n) => n.title.includes("NOTIFY-A")));
  check("but not the planner who submitted it", !(await inboxOf(pt, "plan.submitted")).some((n) => n.title.includes("NOTIFY-A")));

  await call("POST", `/plans/${planA.id}/approve`, { token: at });
  await pause(300);
  const ok = (await inboxOf(pt, "plan.approved")).find((n) => n.title.includes("NOTIFY-A"));
  check("approving tells the planner", !!ok && ok.tone === "success", JSON.stringify(ok));
  check("linking to the plan", ok?.link === `/dashboard/plans/${planA.id}`, ok?.link);

  const planB = (await create("NOTIFY-B")).body.plan;
  await call("POST", `/plans/${planB.id}/submit`, { token: pt });
  await call("POST", `/plans/${planB.id}/reject`, { token: at, body: { reason: "Seat 12 is in the corridor" } });
  await pause(300);
  const back = (await inboxOf(pt, "plan.rejected")).find((n) => n.title.includes("NOTIFY-B"));
  check("sending it back tells the planner why", /Seat 12 is in the corridor/.test(back?.body), back?.body);
  check("and links straight to editing it", back?.link === `/dashboard/plans/${planB.id}/edit`, back?.link);

  console.log("\n== a booking ==");
  const stations = (await call("GET", "/search/stations", { token: ut })).body.stations;
  const dates = (await call("GET", "/search/dates?days=10", { token: ut })).body.dates;
  let found = null;
  for (const date of dates.slice(1)) {
    for (const from of stations.slice(0, 6)) {
      for (const to of stations.slice(0, 12)) {
        if (from.id === to.id) continue;
        const r = await call("GET", `/search/departures?fromStationId=${from.id}&toStationId=${to.id}&date=${date}`, { token: ut });
        const d = (r.body?.departures || []).find((x) => x.availableCount >= 1 && x.fares.length);
        if (d) { found = { from, to, d }; break; }
      }
      if (found) break;
    }
    if (found) break;
  }
  check("a journey to book was found", !!found);
  if (found) {
    const held = await call("POST", "/holds/auto", {
      token: ut,
      body: { tripId: found.d.tripId, fromStationId: found.from.id, toStationId: found.to.id, count: 1, together: true },
    });
    const quote = await call("POST", "/bookings/quote", { token: ut, body: { holdReference: held.body.hold.reference } });
    await call("POST", "/wallet/topup", { token: ut, body: { amount: Math.ceil(quote.body.totalMinor / 100) + 10 } });
    const booked = await call("POST", "/bookings", {
      token: ut,
      body: {
        holdReference: held.body.hold.reference,
        passengers: [{ name: "Inbox Passenger", nid: "1990555566662", dob: "1990-01-01" }],
        method: "wallet",
      },
    });
    check("booked", booked.status === 201, JSON.stringify(booked.body?.error));
    await pause(500);
    const confirmed = (await inboxOf(ut, "booking.confirmed")).find((n) => n.title.includes(booked.body.booking.reference));
    check("the passenger's inbox has the confirmation", !!confirmed, JSON.stringify((await inboxOf(ut)).slice(0, 2)));
    check("naming the train and the journey", confirmed?.body?.includes(found.d.train.name) && /→/.test(confirmed?.body), confirmed?.body);
  }

  console.log("\n== a long job tells whoever started it ==");
  const load = await call("POST", "/railway-data/load", { token: st });
  const job = await finished(load.body.job.id, st);
  check("the railway load finished", job?.status === "succeeded", job?.lastError);
  await pause(300);
  const done = (await inboxOf(st, "job.railway.load.done"))[0];
  check("and its starter was told", /^Railway data loaded — \d+ trains ready/.test(done?.title), done?.title);
  check("with a link back to it", done?.link === "/dashboard/railway-data", done?.link);
  check("nobody else was", !(await inboxOf(at, "job.railway.load.done")).length);

  console.log("\n== the inbox ==");
  const page1 = (await call("GET", "/notifications?limit=2", { token: st })).body;
  check("pages newest first", page1.notifications.length === 2 && page1.notifications[0].id > page1.notifications[1].id);
  check("with a cursor when there is more", Number.isInteger(page1.nextCursor), `${page1.nextCursor}`);
  const page2 = (await call("GET", `/notifications?limit=2&before=${page1.nextCursor}`, { token: st })).body;
  check("and the next page carries on below the cursor",
    page2.notifications?.length > 0 && page2.notifications.every((n) => n.id < page1.nextCursor), JSON.stringify(page2).slice(0, 200));

  const first = (await inboxOf(pt))[0];
  let s = (await call("POST", "/notifications/read", { token: pt, body: { ids: [first.id] } })).body;
  check("reading one lowers the count", Number.isInteger(s.unreadCount));
  const reread = (await call("GET", "/notifications?limit=50", { token: pt })).body.notifications.find((n) => n.id === first.id);
  check("and marks it read", reread.read === true && !!reread.readAt);
  s = (await call("POST", `/notifications/${first.id}/unread`, { token: pt })).body;
  check("it can be marked unread again", (await inboxOf(pt)).find((n) => n.id === first.id)?.read === false);
  check("unread=1 lists only unread", (await call("GET", "/notifications?unread=1&limit=50", { token: pt })).body.notifications.every((n) => !n.read));
  check("category narrows the list", (await call("GET", "/notifications?category=plan&limit=50", { token: pt })).body.notifications.every((n) => n.category === "plan"));

  check("someone else's cannot be read", (await call("POST", `/notifications/${first.id}/unread`, { token: ut })).status === 404);
  check("or dismissed", (await call("DELETE", `/notifications/${first.id}`, { token: ut })).status === 404);
  check("an empty request is refused", (await call("POST", "/notifications/read", { token: pt, body: {} })).status === 400);

  s = (await call("POST", "/notifications/read", { token: pt, body: { all: true } })).body;
  check("all can be read at once", s.unreadCount === 0, JSON.stringify(s));
  const gone = await call("DELETE", `/notifications/${first.id}`, { token: pt });
  check("one can be dismissed", gone.status === 200 && !(await inboxOf(pt)).some((n) => n.id === first.id));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
