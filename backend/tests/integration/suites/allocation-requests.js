// Seat Allocation requests: the searches made in the app recorded beside the
// public page's (channel app / public), never counted against the public
// page's free searches, and analysed — grouped by one or two fields, filtered,
// counted, over time, one by one, as a spreadsheet — by whoever holds
// allocation:requests (the super admin, and the admin role).
const http = require("http");
const path = require("path");
const BACKEND = path.resolve(__dirname, "../../..");
const { PublicVisit, PublicVisitDay, sequelize } = require(`${BACKEND}/src/models`);

const BASE = process.env.API_BASE;
const EDGE = process.env.PUBLIC_EDGE_SECRET;
const PASSWORD = "UnitTest123!";

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -- ${detail}`}`);
};

async function call(method, url, { token, body, text, headers = {} } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": text !== undefined ? "text/plain" : "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(text !== undefined ? { body: text } : body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch {}
  return { status: res.status, body: json, raw, type: res.headers.get("content-type") };
}
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body;
const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 260)}`;
const code = (r) => r.body?.error?.code;

/** A browser, as the web app's server passes it on — to the public page and to the app's search alike. */
const browser = (id, ip, extra = {}) => ({
  "x-sp-edge": EDGE,
  "x-sp-visitor": id,
  "x-sp-client-ip": ip,
  "x-sp-country": "BD",
  "x-sp-city": "Rajshahi",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36",
  "accept-language": "en-GB,en;q=0.9",
  ...extra,
});

// Cloudflare's bot check, as far as the API can tell: "good-token" passes.
const turnstile = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const form = new URLSearchParams(raw);
    const ok = form.get("secret") === process.env.TURNSTILE_SECRET_KEY && form.get("response") === "good-token";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: ok }));
  });
});

const HEAD = "From,To,Result,Trains with seats (classes),Trains on the route,Scanned at";
const AT = "2026-10-20T17:20:39.444Z";
const STOPS = {
  trains: [
    { number: 9401, name: "REQUEST EXPRESS", stops: ["Ra", "Rb", "Rc", "Rd", "Re"] },
    { number: 9402, name: "OTHER INTERCITY", stops: ["Ra", "Rc", "Re"] },
  ],
};
const CENSUS = [
  HEAD,
  `"Ra","Rc","Allocated","REQUEST EXPRESS (9401): S_CHAIR; OTHER INTERCITY (9402): SNIGDHA","REQUEST EXPRESS (9401); OTHER INTERCITY (9402)","${AT}"`,
  `"Ra","Re","Allocated","OTHER INTERCITY (9402): AC_B","REQUEST EXPRESS (9401); OTHER INTERCITY (9402)","${AT}"`,
  `"Rc","Re","Not allocated","—","REQUEST EXPRESS (9401); OTHER INTERCITY (9402)","${AT}"`,
].join("\n");

(async () => {
  await new Promise((r) => turnstile.listen(47331, "127.0.0.1", r));
  const su = await login("unittest-super1@example.com");
  const admin = await login("unittest-admin@example.com");
  const user = await login("unittest-user@example.com");
  const S = su.accessToken, A = admin.accessToken, U = user.accessToken;
  const set = (key, value) => call("PUT", `/settings/${key}`, { token: S, body: { value } });
  const analyse = (q, token = S) => call("GET", `/allocation/requests?${q}`, { token });
  const group = (r, ...labels) => r.body?.groups?.find((g) => labels.every((l, i) => g.labels[i] === l));

  await call("POST", "/allocation/import/stops?apply=1&name=routes.json", { token: S, text: JSON.stringify(STOPS) });
  await call("POST", "/allocation/import/census?apply=1&name=census.csv", { token: S, text: CENSUS });
  await PublicVisit.destroy({ where: {} });

  try {
    console.log("== a search in the app ==");
    const AS = browser("app-browser-super-0001", "203.0.113.5");
    const found = await call("GET", "/allocation?from=Ra&to=Rc", { token: S, headers: AS });
    check("answered as before", found.status === 200 && found.body.total === 2, say(found));
    const row = await PublicVisit.findOne({ where: { channel: "app", userId: su.user.id } });
    check("and recorded: from the app, who, and what was searched", row?.kind === "list" && row.outcome === "shown" &&
      row.query?.from === "Ra" && row.query?.to === "Rc" && row.queryKey === "Ra|Rc|||" && row.results === 2, JSON.stringify(row));
    check("from where, as the web app vouches for it", row?.ip === "203.0.113.5" && row.country === "BD" && row.city === "Rajshahi" &&
      row.visitorId === "app-browser-super-0001" && row.browser === "Chrome 141" && row.os === "Windows", JSON.stringify(row));
    await call("GET", "/allocation?from=Re", { token: S, headers: AS });
    await call("GET", "/allocation?train=9401&show=all&pageSize=1000", { token: S, headers: AS });
    const direct = await call("GET", "/allocation?to=Re", { token: S });
    const directRow = await PublicVisit.findOne({ where: { channel: "app", queryKey: "|Re|||" } });
    check("called directly, not through the web app: still recorded, with no place claimed", direct.status === 200 &&
      directRow && directRow.country === null && directRow.city === null, JSON.stringify(directRow));

    console.log("\n== on the public page ==");
    await set("allocation.public_enabled", true);
    await set("allocation.public_free_searches", 1);
    // The passenger's browser: a search in the app first, then the public page.
    const UB = browser("user-browser-00000001", "198.51.100.60");
    check("a passenger searches in the app while it is public", (await call("GET", "/allocation?train=9402", { token: U, headers: UB })).status === 200);
    const UP = { ...UB, "x-sp-pass": (await call("POST", "/public/allocation/pass", { headers: UB, body: { token: "good-token" } })).body.pass };
    await call("GET", "/public/allocation/meta", { headers: UP });
    const firstFree = await call("GET", "/public/allocation?from=Ra", { headers: UP });
    check("searches in the app use none of the public page's free searches", firstFree.status === 200, say(firstFree));
    const second = await call("GET", "/public/allocation?from=Rc", { headers: UP });
    check("its own count still holds", second.status === 403 && code(second) === "SIGN_IN_REQUIRED", say(second));
    const signed = await call("GET", "/public/allocation?from=Rc", { headers: UB, token: U });
    check("signed in on the public page, it goes through", signed.status === 200, say(signed));
    const V = browser("anon-browser-00000001", "198.51.100.61", { "x-sp-referrer": "https://www.facebook.com/groups/railway" });
    const VP = { ...V, "x-sp-pass": (await call("POST", "/public/allocation/pass", { headers: V, body: { token: "good-token" } })).body.pass };
    await call("GET", "/public/allocation?to=Re", { headers: VP });

    const inDb = async (where) => PublicVisit.count({ where: { kind: "list", ...where } });
    const pub = await inDb({ channel: "public" });
    const app = await inDb({ channel: "app" });
    check("both kept, each saying where from", pub === 4 && app === 5, `public ${pub}, app ${app}`);
    const panel = (await call("GET", "/allocation/public-visits", { token: S })).body;
    const publicRows = await PublicVisit.count({ where: { channel: "public" } });
    check("the public page's own view counts only its own", panel?.today?.searches === 3 && panel.latest.length === publicRows &&
      !panel.latest.some((v) => v.visitorId === "app-browser-super-0001"), `${JSON.stringify(panel?.today)} · ${panel?.latest?.length} of ${publicRows}`);

    console.log("\n== grouped and counted ==");
    const byChannel = await analyse("by=channel");
    check("by public page or app: searches only, by default", byChannel.status === 200 &&
      group(byChannel, "Public page")?.requests === pub && group(byChannel, "In the app")?.requests === app, say(byChannel));
    const t = byChannel.body.totals;
    check("the totals: searches, each side, people, visitors", t.requests === pub + app && t.public === pub && t.app === app &&
      t.people === 2 && t.visitors === 3, JSON.stringify(t));
    check("with the fields there are to group by", byChannel.body.dimensions.length >= 25 &&
      byChannel.body.dimensions.some((d) => d.key === "station" && d.group === "Journey"));

    const byPerson = await analyse("by=person,channel");
    check("by person, then where: names and emails, and who was not signed in",
      group(byPerson, `${su.user.fullName} (unittest-super1@example.com)`, "In the app")?.requests === 4 &&
      group(byPerson, `${user.user.fullName} (unittest-user@example.com)`, "In the app")?.requests === 1 &&
      group(byPerson, `${user.user.fullName} (unittest-user@example.com)`, "Public page")?.requests === 1 &&
      group(byPerson, "Not signed in", "Public page")?.requests === 3, JSON.stringify(byPerson.body?.groups?.map((g) => [g.labels, g.requests])));

    const byTrain = await analyse("by=train&w=channel:app");
    check("by train, in the app only: named as the railway names it", group(byTrain, "9401 REQUEST EXPRESS")?.requests === 1 &&
      group(byTrain, "9402 OTHER INTERCITY")?.requests === 1 && group(byTrain, "Any train")?.requests === 3,
      JSON.stringify(byTrain.body?.groups?.map((g) => [g.labels, g.requests])));
    check("the filter, named", byTrain.body.filters?.[0]?.label === "In the app" && byTrain.body.filters[0].field === "Public page or app",
      JSON.stringify(byTrain.body.filters));

    const byStation = await analyse("by=station");
    check("by station: a journey counts at both ends", group(byStation, "Ra")?.requests === 2 && group(byStation, "Rc")?.requests === 3 &&
      group(byStation, "Re")?.requests === 3, JSON.stringify(byStation.body?.groups?.map((g) => [g.labels, g.requests])));
    const atRc = await analyse("by=journey&w=station:Rc");
    check("only a station: searches from it or to it", atRc.body.totals.requests === 3 && group(atRc, "Ra → Rc")?.requests === 1 &&
      group(atRc, "From Rc")?.requests === 2, JSON.stringify(atRc.body?.groups?.map((g) => [g.labels, g.requests])));

    const anon = await analyse("by=channel&w=person:");
    check("only those not signed in", anon.body.totals.requests === 3 && anon.body.totals.people === 0, JSON.stringify(anon.body.totals));
    const nothing = await analyse("by=found");
    check("searches that found nothing, counted apart", group(nothing, "Found nothing")?.requests === nothing.body.totals.nothing &&
      nothing.body.totals.nothing >= 1, JSON.stringify(nothing.body?.groups?.map((g) => [g.labels, g.requests])));
    const site = await analyse("by=site&w=channel:public");
    check("by the site they came from", group(site, "facebook.com")?.requests === 1, JSON.stringify(site.body?.groups?.map((g) => g.labels)));
    const roles = await analyse("by=role");
    check("by role, through each person's roles", group(roles, "Not signed in")?.requests === 3 &&
      roles.body.groups.some((g) => g.values[0] === "super_admin"), JSON.stringify(roles.body?.groups?.map((g) => [g.labels, g.requests])));
    const kinds = await analyse("by=kind&all=1");
    check("with every request: page opens and bot checks too", group(kinds, "Opened the page")?.requests >= 1 &&
      group(kinds, "Bot check")?.requests >= 2 && kinds.body.totals.requests > t.requests, JSON.stringify(kinds.body?.groups?.map((g) => [g.labels, g.requests])));

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
    const hours = await analyse(`by=hour&since=${today}&until=${today}`);
    check("over a day, counted by the hour", hours.body.series.size === "hour" && hours.body.series.points.length === 24 &&
      hours.body.series.points.reduce((s, p) => s + p.requests, 0) === t.requests, JSON.stringify(hours.body.series).slice(0, 200));
    check("by day, by default", byChannel.body.series.size === "day" && byChannel.body.series.points.length === 30 &&
      byChannel.body.series.points.at(-1).at === today);
    check("one by one, newest first, with who", byChannel.body.latest[0]?.channel === "public" && byChannel.body.latest.length === t.requests &&
      byChannel.body.latest.some((l) => l.user?.email === "unittest-super1@example.com" && l.channel === "app"), JSON.stringify(byChannel.body.latest[0]));

    const sheet = await call("GET", "/allocation/requests.csv?by=channel,person", { token: S });
    check("as a spreadsheet", sheet.status === 200 && /text\/csv/.test(sheet.type) &&
      sheet.raw.includes("Public page or app,Person,Requests,People,Visitors,Found nothing,Last") &&
      sheet.raw.includes(`In the app,${su.user.fullName} (unittest-super1@example.com),4,1,1,`), sheet.raw.slice(0, 300));
    const counted = await call("GET", "/allocation/requests/today", { token: S });
    check("today's searches, for the tab", counted.body?.searches === t.requests, say(counted));

    check("an unknown field is refused", (await analyse("by=nope")).status === 400);
    check("so is an unknown filter", (await analyse("w=nope:1")).status === 400);
    check("and days the wrong way round", (await analyse("since=2026-10-20&until=2026-10-01")).status === 400);

    console.log("\n== who may ==");
    check("the admin role may", (await analyse("by=channel", A)).status === 200 && (await call("GET", "/allocation/requests/today", { token: A })).status === 200);
    for (const [label, url] of [
      ["the analysis", "/allocation/requests"],
      ["the spreadsheet", "/allocation/requests.csv"],
      ["today's count", "/allocation/requests/today"],
      ["the public page's view", "/allocation/public-visits"],
    ]) {
      check(`a passenger may not see ${label}`, (await call("GET", url, { token: U })).status === 403);
    }
    await call("PUT", "/features/seat-allocation", { token: S, body: { state: "off_all" } });
    const off = await analyse("by=channel");
    check("with Seat Allocation switched off, neither may anyone", off.status === 403 && code(off) === "FEATURE_UNAVAILABLE", say(off));
    await call("PUT", "/features/seat-allocation", { token: S, body: { state: "on" } });

    console.log("\n== the days kept ==");
    const old = new Date(Date.now() - 100 * 86_400_000);
    const oldDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(old);
    for (const [channel, n] of [["public", 2], ["app", 3]]) {
      for (let i = 0; i < n; i++) {
        await PublicVisit.create({
          channel,
          kind: "list",
          outcome: "shown",
          visitorId: `old-${channel}-browser-0000`,
          query: { from: "Ra", to: null, train: null, class: null, show: "allocated", page: 1 },
          queryKey: "Ra||||",
          results: 1,
          createdAt: old,
          updatedAt: old,
        });
      }
    }
    await require(`${BACKEND}/src/services/publicAllocationService`).prune();
    const days = await PublicVisitDay.findAll({ where: { day: oldDay } });
    const of = (c) => days.find((d) => d.channel === c);
    check("folded into each day's totals, the public page's and the app's apart", days.length === 2 &&
      of("public")?.searches === 2 && of("app")?.searches === 3, JSON.stringify(days.map((d) => d.toJSON())));
    const longAgo = await analyse(`by=channel&since=${oldDay}`);
    check("an analysis reaching back says what is left of them", longAgo.body.earlier?.searches === 5 &&
      longAgo.body.earlier.byChannel?.app?.searches === 3 && longAgo.body.series.size === "week", JSON.stringify(longAgo.body.earlier));
    check("and the public page's view, only its own", (await call("GET", "/allocation/public-visits", { token: S })).body.earlier?.searches === 2);
  } finally {
    await set("allocation.public_enabled", false);
    await set("allocation.public_free_searches", 5);
    await call("PUT", "/features/seat-allocation", { token: S, body: { state: "on" } });
    turnstile.close();
    await sequelize.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  turnstile.close();
  process.exit(1);
});
