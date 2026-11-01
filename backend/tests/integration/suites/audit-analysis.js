// The audit log analysed: events of its own (operations under "zztest.")
// placed at known Dhaka times, from known people and browsers, then counted —
// by operation, person, role, hour, weekday, browser, device; within hours of
// the day and days of the week; the last hour; two people side by side; as a
// spreadsheet; refused for whoever may not read the log. Skips without the
// document store, as the other audit suites do.
const path = require("path");
const BACKEND = path.resolve(__dirname, "../../..");
const { connectMongo, isMongoConnected, mongoose } = require(`${BACKEND}/src/config/mongo`);
const { parseUserAgent } = require(`${BACKEND}/src/utils/userAgent`);
const { todayInDhaka, addDays } = require(`${BACKEND}/src/utils/dhakaTime`);

const BASE = process.env.API_BASE;
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, url, { token, body } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch {}
  return { status: res.status, body: json, raw, type: res.headers.get("content-type") };
}
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body;
const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CURL = "curl/8.4.0";

/** The latest day on this weekday (0 Sunday … 6 Saturday) at least `back` days ago, in Dhaka. */
function lastWeekday(weekday, back = 2) {
  let d = addDays(todayInDhaka(), -back);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== weekday) d = addDays(d, -1);
  return d;
}

(async () => {
  const su = await login("unittest-super1@example.com");
  const user = await login("unittest-user@example.com");
  const S = su.accessToken, U = user.accessToken;

  const probe = await call("GET", "/audit/analysis", { token: S });
  if (probe.body?.available === false || !process.env.MONGO_URI) {
    console.log("  (no document store here — skipped)");
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(0);
  }
  await connectMongo();
  if (!isMongoConnected()) throw new Error("The suite could not reach the document store");
  const AuditEvent = require(`${BACKEND}/src/models/mongo/AuditEvent`);
  await AuditEvent.deleteMany({ action: /^zztest\./ });

  const saturday = lastWeekday(6);
  const monday = lastWeekday(1);
  const at = (day, time) => new Date(`${day}T${time}:00+06:00`);
  // The roles each held, as the log keeps them with every event.
  const ROLES = new Map([[su.user.id, ["super_admin"]], [user.user.id, ["user"]]]);
  const event = (action, who, when, { outcome = "success", ip, ua } = {}) => ({
    action,
    actor: who ? { id: who.user.id, email: who.user.email, roles: ROLES.get(who.user.id) } : { id: null, email: null, roles: [] },
    entity: { type: "zztest_thing", id: "7", label: "The test thing" },
    outcome,
    context: { ipAddress: ip, userAgent: ua, method: "POST", path: "/api/v1/zztest" },
    at: when,
  });
  const events = [
    ...[1, 2, 3].map(() => event("zztest.alpha", su, at(saturday, "09:30"), { ip: "203.0.113.1", ua: CHROME })),
    event("zztest.alpha", user, at(monday, "22:15"), { ip: "203.0.113.2", ua: IPHONE }),
    event("zztest.alpha", user, at(monday, "22:45"), { ip: "203.0.113.2", ua: IPHONE, outcome: "failure" }),
    event("zztest.beta", null, at(monday, "23:40"), { ip: "203.0.113.3", ua: CURL }),
    event("zztest.beta", su, at(addDays(todayInDhaka(), -40), "12:00"), { ip: "203.0.113.1", ua: CHROME }),
    event("zztest.gamma", null, new Date(Date.now() - 10 * 60_000), { ip: "203.0.113.4", ua: CURL }),
  ];
  await AuditEvent.collection.insertMany(events);

  const ask = (q, token = S) => call("GET", `/audit/analysis?area=zztest&tests=1&${q}`, { token });
  const group = (r, ...labels) => r.body?.groups?.find((g) => labels.every((l, i) => g.labels[i] === l));
  const groups = (r) => JSON.stringify(r.body?.groups?.map((g) => [g.labels.join(" / "), g.events]));

  try {
    console.log("== counted ==");
    const byOp = await ask("by=action");
    check("by operation, over the last 30 days", byOp.status === 200 && group(byOp, "zztest.alpha")?.events === 5 &&
      group(byOp, "zztest.beta")?.events === 1 && group(byOp, "zztest.gamma")?.events === 1, say(byOp));
    const t = byOp.body.totals;
    check("the totals: events, people, addresses, failures", t.events === 7 && t.people === 2 && t.ips === 4 && t.failures === 1,
      JSON.stringify(t));
    check("with every operation there is, to choose from", byOp.body.operations.includes("auth.login") &&
      byOp.body.operations.includes("zztest.alpha"));

    const byPerson = await ask("by=person");
    check("by person: named, with email, and no one signed in", group(byPerson, `${su.user.fullName} (unittest-super1@example.com)`)?.events === 3 &&
      group(byPerson, `${user.user.fullName} (unittest-user@example.com)`)?.events === 2 && group(byPerson, "No one signed in")?.events === 2,
      groups(byPerson));
    const roles = await ask("by=role");
    check("by role", group(roles, "super_admin")?.events === 3 && group(roles, "user")?.events === 2 && group(roles, "No role")?.events === 2,
      groups(roles));

    console.log("\n== when ==");
    const byHour = await ask("by=hour");
    check("by hour of the day, on Dhaka's clock", group(byHour, "09:00–10:00")?.events === 3 && group(byHour, "22:00–23:00")?.events === 2 &&
      group(byHour, "23:00–00:00")?.events === 1, groups(byHour));
    const byDay = await ask("by=weekday");
    check("by day of the week", group(byDay, "Saturday")?.events === 3 && group(byDay, "Monday")?.events === 3, groups(byDay));
    const late = await ask("hours=22-1");
    check("only late at night, past midnight", late.body.totals.events === 3, JSON.stringify(late.body.totals));
    check("only on Saturdays", (await ask("days=7")).body.totals.events === 3);
    const sat = byOp.body.heatmap.find((r) => r.name === "Saturday");
    const mon = byOp.body.heatmap.find((r) => r.name === "Monday");
    check("the weekday × hour grid, Saturday first", byOp.body.heatmap[0].name === "Saturday" && sat.hours[9] === 3 &&
      mon.hours[22] === 2 && mon.hours[23] === 1, JSON.stringify(byOp.body.heatmap.map((r) => r.name)));
    check("over the days, a bar a day", byOp.body.series.size === "day" && byOp.body.series.points.length === 30 &&
      byOp.body.series.points.find((p) => p.at === saturday)?.events === 3);
    const lastHour = await ask("last=60");
    check("the last hour, in five-minute steps", lastHour.body.totals.events === 1 && lastHour.body.series.size === "5min" &&
      lastHour.body.series.points.reduce((s, p) => s + p.events, 0) === 1, JSON.stringify(lastHour.body.totals));
    const longer = await ask(`since=${addDays(todayInDhaka(), -45)}`);
    check("a longer span reaches the older one", longer.body.totals.events === 8, JSON.stringify(longer.body.totals));

    console.log("\n== from what ==");
    const browsers = await ask("by=browser");
    const chrome = parseUserAgent(CHROME).browser;
    const safari = parseUserAgent(IPHONE).browser;
    check("by browser, read as the public page's visits are", group(browsers, chrome)?.events === 3 && group(browsers, safari)?.events === 2 &&
      group(browsers, "Unknown")?.events === 2, `${chrome}, ${safari}: ${groups(browsers)}`);
    const devices = await ask("by=device");
    check("by device: computer, phone, robot", group(devices, "computer")?.events === 3 && group(devices, "phone")?.events === 2 &&
      group(devices, "bot")?.events === 2, groups(devices));
    const systems = await ask("by=os");
    check("by operating system", group(systems, "Windows")?.events === 3 && group(systems, "iOS")?.events === 2, groups(systems));

    console.log("\n== narrowed ==");
    check("failures only", (await ask("outcome=failure")).body.totals.events === 1);
    const noOne = await ask("by=action&w=person:");
    check("no one signed in only", noOne.body.totals.events === 2 && noOne.body.filters?.[0]?.label === "No one signed in",
      JSON.stringify(noOne.body.filters));
    const two = await ask("by=action,outcome&w=action:zztest.alpha");
    check("two fields: operation, then outcome", group(two, "zztest.alpha", "Succeeded")?.events === 4 &&
      group(two, "zztest.alpha", "Failed")?.events === 1, groups(two));
    const target = await ask("by=target");
    check("by target, named as the log names it", group(target, "The test thing (zztest_thing #7)")?.events === 7, groups(target));
    const hidden = await call("GET", "/audit/analysis?area=zztest&by=action", { token: S });
    check("test accounts left out by default: only no one's", hidden.body.totals.events === 2, JSON.stringify(hidden.body.totals));
    check("one by one, newest first", byOp.body.latest[0]?.action === "zztest.gamma" && byOp.body.latest.length === 7);

    console.log("\n== side by side ==");
    const side = await ask(`person=${su.user.id},${user.user.id}&compare=1`);
    const of = (id) => side.body.compare?.find((c) => c.person.id === id);
    check("two people, each their own", side.body.compare?.length === 2 && of(su.user.id)?.totals.events === 3 &&
      of(user.user.id)?.totals.events === 2 && of(user.user.id)?.totals.failures === 1, JSON.stringify(side.body.compare?.map((c) => c.totals)));
    check("with their own grid and days", of(su.user.id)?.heatmap.find((r) => r.name === "Saturday")?.hours[9] === 3 &&
      of(user.user.id)?.series.points.length === 30);
    check("one person alone is not side by side", (await ask(`person=${su.user.id}&compare=1`)).body.compare === null);

    console.log("\n== as a spreadsheet, and people found ==");
    const sheet = await call("GET", "/audit/analysis.csv?area=zztest&tests=1&by=action,outcome", { token: S });
    check("the groups as CSV", sheet.status === 200 && /text\/csv/.test(sheet.type) &&
      sheet.raw.includes("Operation,Outcome,Events,People,Internet addresses,Failures,Last") && sheet.raw.includes("zztest.alpha,Succeeded,4,"),
      sheet.raw.slice(0, 200));
    const found = await call("GET", "/audit/people?q=unittest-user", { token: S });
    check("people found by part of their email", found.body?.people?.some((p) => p.id === user.user.id && p.events >= 2), say(found));

    console.log("\n== refused ==");
    check("an unknown field", (await ask("by=nope")).status === 400);
    check("an operation that is not one", (await call("GET", "/audit/analysis?action=$where", { token: S })).status === 400);
    check("without the audit log's permission", (await ask("by=action", U)).status === 403 &&
      (await call("GET", "/audit/people?q=a", { token: U })).status === 403);
    await call("PUT", "/features/audit", { token: S, body: { state: "off_all" } });
    const off = await ask("by=action");
    check("with the Audit Log switched off", off.status === 403 && off.body?.error?.code === "FEATURE_UNAVAILABLE", say(off));
    await call("PUT", "/features/audit", { token: S, body: { state: "on" } });
  } finally {
    await call("PUT", "/features/audit", { token: S, body: { state: "on" } });
    await AuditEvent.deleteMany({ action: /^zztest\./ });
    await mongoose.disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
