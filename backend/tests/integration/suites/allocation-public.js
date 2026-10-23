// Seat Allocation for everyone (/seat-allocation): switched on and off in
// Settings, only through the web app (which this suite plays, with the shared
// secret), behind a bot check (a stand-in answers for Cloudflare), rate-limited,
// with a few free searches a day before a sign-in is asked for. Every request
// recorded; the records shown to managers and folded into daily totals.
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
  return { status: res.status, body: json, retryAfter: res.headers.get("retry-after") };
}
const login = async (email) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).body;
const say = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 220)}`;
const code = (r) => r.body?.error?.code;

/** A visitor, as the web app's server passes them on. */
const visitor = (id, ip, extra = {}) => ({
  "x-sp-edge": EDGE,
  "x-sp-visitor": id,
  "x-sp-client-ip": ip,
  "x-sp-country": "BD",
  "x-sp-city": "Dhaka",
  "x-sp-referrer": "https://www.facebook.com/",
  "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36",
  "accept-language": "bn-BD,bn;q=0.9,en;q=0.8",
  ...extra,
});

// Cloudflare, as far as the API can tell: "good-token" passes, anything else not.
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
    { number: 9301, name: "PUBLIC EXPRESS", stops: ["Pa", "Pb", "Pc", "Pd", "Pe"] },
    { number: 9302, name: "OTHER MAIL", stops: ["Pa", "Pc", "Pe"] },
  ],
};
const CENSUS = [
  HEAD,
  `"Pa","Pc","Allocated","PUBLIC EXPRESS (9301): S_CHAIR, SNIGDHA; OTHER MAIL (9302): S_CHAIR","PUBLIC EXPRESS (9301); OTHER MAIL (9302)","${AT}"`,
  `"Pa","Pe","Allocated","OTHER MAIL (9302): AC_B","PUBLIC EXPRESS (9301); OTHER MAIL (9302)","${AT}"`,
  `"Pb","Pd","Allocated","PUBLIC EXPRESS (9301): SHOVAN","PUBLIC EXPRESS (9301)","${AT}"`,
  `"Pc","Pe","Not allocated","—","PUBLIC EXPRESS (9301); OTHER MAIL (9302)","${AT}"`,
].join("\n");

(async () => {
  await new Promise((r) => turnstile.listen(47331, "127.0.0.1", r));
  const su = await login("unittest-super1@example.com");
  const user = await login("unittest-user@example.com");
  const S = su.accessToken, U = user.accessToken;
  const set = (key, value) => call("PUT", `/settings/${key}`, { token: S, body: { value } });

  await call("POST", "/allocation/import/stops?apply=1&name=routes.json", { token: S, text: JSON.stringify(STOPS) });
  await call("POST", "/allocation/import/census?apply=1&name=census.csv", { token: S, text: CENSUS });

  try {
    console.log("\n== switched off, as it starts ==");
    const off = await call("GET", "/public/allocation/status", { headers: visitor("visitor-off-000000001", "198.51.100.1") });
    check("the page says it is not open", off.status === 200 && off.body.enabled === false, say(off));
    const offMeta = await call("GET", "/public/allocation/meta", { headers: visitor("visitor-off-000000001", "198.51.100.1") });
    check("its data is not served", offMeta.status === 404 && code(offMeta) === "PUBLIC_OFF", say(offMeta));
    check("a signed-in passenger cannot see it in the app either", (await call("GET", "/allocation/meta", { token: U })).status === 403);
    check("nor is it among what everyone signed in may see", JSON.stringify((await call("GET", "/auth/me", { token: U })).body.publicFeatures) === "[]");

    console.log("\n== switched on ==");
    await set("allocation.public_enabled", true);
    const on = await call("GET", "/public/allocation/status", { headers: visitor("visitor-on-0000000001", "198.51.100.1") });
    check("open, with the bot check's site key", on.body.enabled === true && on.body.botCheck?.siteKey === "test-site-key", say(on));
    const refused = await call("GET", "/public/allocation/meta", {
      headers: { "x-sp-visitor": "visitor-direct-00000001", "x-sp-client-ip": "203.0.113.66" },
    });
    check("asked directly, not through the web app: refused", refused.status === 403 && code(refused) === "REFUSED", say(refused));
    const wrongSecret = await call("GET", "/public/allocation/meta", { headers: visitor("visitor-direct-00000002", "203.0.113.66", { "x-sp-edge": "guess" }) });
    check("and with a guessed secret", wrongSecret.status === 403 && code(wrongSecret) === "REFUSED");

    const V1 = visitor("visitor-one-0000000001", "198.51.100.10");
    const meta = await call("GET", "/public/allocation/meta", { headers: V1 });
    check("the filters and when the data was brought up to date", meta.status === 200 && meta.body.trains.length >= 2 &&
      meta.body.stations.includes("Pa") && meta.body.lastUpdated && meta.body.railwayChecked?.from, say(meta));
    check("without who uploaded what", !JSON.stringify(meta.body).includes(su.user.fullName) && !("latest" in meta.body), Object.keys(meta.body).join());
    check("not signed in", meta.body.signedIn === false);

    console.log("\n== the bot check ==");
    const noPass = await call("GET", "/public/allocation?from=Pa", { headers: V1 });
    check("a search without a pass is asked to take the check", noPass.status === 403 && code(noPass) === "BOT_CHECK" &&
      noPass.body.error.details?.siteKey === "test-site-key", say(noPass));
    const badToken = await call("POST", "/public/allocation/pass", { headers: V1, body: { token: "bad-token" } });
    check("a token that does not pass gets no pass", badToken.status === 403 && code(badToken) === "BOT_CHECK", say(badToken));
    const passed = await call("POST", "/public/allocation/pass", { headers: V1, body: { token: "good-token" } });
    check("one that passes gets a pass for an hour", passed.status === 200 && passed.body.pass &&
      Math.abs(new Date(passed.body.expiresAt) - Date.now() - 3600_000) < 60_000, say(passed));
    const P1 = { ...V1, "x-sp-pass": passed.body.pass };
    const theirs = await call("GET", "/public/allocation?from=Pa", { headers: { ...visitor("visitor-two-0000000002", "198.51.100.10"), "x-sp-pass": passed.body.pass } });
    check("a pass belongs to its browser", theirs.status === 403 && code(theirs) === "BOT_CHECK");

    console.log("\n== searching ==");
    const first = await call("GET", "/public/allocation?from=Pa", { headers: P1 });
    check("with the pass, the trains with seats from Pa", first.status === 200 && first.body.total === 3, say(first));
    check("where each pair came from is not shown", first.body.items.every((i) => !("source" in i)));
    const grid = await call("GET", "/public/allocation?train=9301&show=all&pageSize=1000", { headers: P1 });
    check("a train's grid, with its route", grid.status === 200 && grid.body.route?.join() === "Pa,Pb,Pc,Pd,Pe" && grid.body.total === 10, say(grid));

    console.log("\n== free searches ==");
    await set("allocation.public_free_searches", 2);
    const V2 = visitor("visitor-free-000000001", "198.51.100.20");
    const P2 = { ...V2, "x-sp-pass": (await call("POST", "/public/allocation/pass", { headers: V2, body: { token: "good-token" } })).body.pass };
    check("arriving — every allocated pair — is not a search", (await call("GET", "/public/allocation", { headers: P2 })).status === 200 &&
      (await call("GET", "/public/allocation?page=2", { headers: P2 })).status === 200);
    check("a first search", (await call("GET", "/public/allocation?from=Pa", { headers: P2 })).status === 200);
    check("a second", (await call("GET", "/public/allocation?to=Pe", { headers: P2 })).status === 200);
    check("the first again, its next page: still free", (await call("GET", "/public/allocation?from=Pa&page=2", { headers: P2 })).status === 200);
    const third = await call("GET", "/public/allocation?train=9302", { headers: P2 });
    check("a third: asked to sign in, saying how many were free", third.status === 403 && code(third) === "SIGN_IN_REQUIRED" &&
      third.body.error.details?.freeSearches === 2 && /Sign in or create a free account/.test(third.body.error.message), say(third));
    const signedIn = await call("GET", "/public/allocation?train=9302", { headers: V2, token: U });
    check("signed in, the same search goes through — no limit, no bot check", signedIn.status === 200, say(signedIn));
    const metaSigned = await call("GET", "/public/allocation/meta", { headers: V2, token: U });
    check("and the page knows they are signed in", metaSigned.body.signedIn === true);

    await set("allocation.public_free_searches", 100);
    await set("allocation.public_searches_per_ip_day", 3);
    const shared = (n) => visitor(`visitor-shared-${String(n).padStart(8, "0")}`, "198.51.100.30");
    const passFor = async (h) => ({ ...h, "x-sp-pass": (await call("POST", "/public/allocation/pass", { headers: h, body: { token: "good-token" } })).body.pass });
    const A = await passFor(shared(1)), B = await passFor(shared(2));
    await call("GET", "/public/allocation?from=Pa", { headers: A });
    await call("GET", "/public/allocation?from=Pb", { headers: A });
    await call("GET", "/public/allocation?from=Pc", { headers: B });
    const overIp = await call("GET", "/public/allocation?from=Pd", { headers: B });
    check("one internet address has its own allowance, across its browsers", overIp.status === 403 && code(overIp) === "SIGN_IN_REQUIRED", say(overIp));
    await set("allocation.public_searches_per_ip_day", 200);
    await set("allocation.public_free_searches", 5);

    console.log("\n== rate limits ==");
    await set("allocation.public_requests_per_minute", 3);
    const F = visitor("visitor-flood-00000001", "198.51.100.40");
    const flood = [];
    for (let i = 0; i < 6; i++) flood.push(await call("GET", "/public/allocation/meta", { headers: F }));
    const limited = flood.filter((r) => r.status === 429);
    check("past the requests a minute, asked to wait", flood.slice(0, 3).every((r) => r.status === 200) && limited.length === 3 &&
      code(limited[0]) === "RATE_LIMITED", flood.map((r) => r.status).join(","));
    check("for how long", Number(limited[0]?.retryAfter) > 0 && Number(limited[0].retryAfter) <= 60, limited[0]?.retryAfter);
    check("another address carries on", (await call("GET", "/public/allocation/meta", { headers: visitor("visitor-calm-000000001", "198.51.100.41") })).status === 200);
    await set("allocation.public_requests_per_minute", 60);

    console.log("\n== what is recorded ==");
    await new Promise((r) => setTimeout(r, 400));
    const mine = await PublicVisit.findAll({ where: { visitorId: "visitor-one-0000000001" }, order: [["id", "ASC"]] });
    const shownList = mine.find((v) => v.kind === "list" && v.outcome === "shown");
    check("each request, with where it came from", shownList && shownList.ip === "198.51.100.10" && shownList.country === "BD" &&
      shownList.city === "Dhaka" && shownList.referrer === "https://www.facebook.com/", JSON.stringify(shownList?.toJSON()));
    check("and what browser on what", shownList?.browser === "Chrome 141" && shownList.os === "Android" && shownList.device === "phone" &&
      shownList.language === "bn-BD", JSON.stringify(shownList?.toJSON()));
    check("what was searched and how many results", shownList?.query?.from === "Pa" && shownList.results === 3 && shownList.queryKey === "Pa||||");
    // A refusal is recorded once a minute per address and outcome: the bad token's is folded into the first.
    check("the bot check asked and passed, and the open page", ["meta:shown", "list:bot_check", "pass:shown"].every((k) =>
      mine.some((v) => `${v.kind}:${v.outcome}` === k)), mine.map((v) => `${v.kind}:${v.outcome}`).join(","));
    const floodRows = await PublicVisit.count({ where: { ip: "198.51.100.40", outcome: "rate_limited" } });
    check("a flood turned away is recorded once, not once a request", floodRows === 1, `${floodRows}`);
    // Refused, its address is not believed: it is recorded under the one the request really came from.
    const refusedRows = await PublicVisit.findAll({ where: { outcome: "refused" } });
    check("the requests refused for coming direct are recorded, once, without the address they claimed",
      refusedRows.length === 1 && refusedRows[0].ip !== "203.0.113.66", JSON.stringify(refusedRows.map((r) => r.ip)));
    const asked = await PublicVisit.findOne({ where: { visitorId: "visitor-free-000000001", outcome: "sign_in" } });
    check("being asked to sign in is recorded, with the search", asked?.query?.train === 9302);
    const signedRow = await PublicVisit.findOne({ where: { visitorId: "visitor-free-000000001", userId: user.user.id, kind: "list" } });
    check("a signed-in visit is tied to its account", Boolean(signedRow));

    const panel = await call("GET", "/allocation/public-visits", { token: S });
    check("managers see today's totals", panel.status === 200 && panel.body.today.searches >= 6 && panel.body.today.prompted >= 2 &&
      panel.body.today.blocked >= 3 && panel.body.today.visitors >= 5, say(panel));
    check("the journeys searched most", panel.body.journeys.some((j) => j.query?.from === "Pa" && j.searches >= 3), JSON.stringify(panel.body.journeys));
    check("where from and on what", panel.body.countries[0]?.value === "BD" && panel.body.devices[0]?.value === "phone");
    check("the latest visits, newest first", panel.body.latest.length > 10 && new Date(panel.body.latest[0].at) >= new Date(panel.body.latest[5].at));
    check("and how it is set up", panel.body.enabled === true && panel.body.botCheck === true && panel.body.edgeSecret === true && panel.body.keptDays === 90);
    check("a passenger may not see them", (await call("GET", "/allocation/public-visits", { token: U })).status === 403);

    console.log("\n== everyone signed in, while it is public ==");
    check("it is among what everyone signed in may see", JSON.stringify((await call("GET", "/auth/me", { token: U })).body.publicFeatures) === '["seat-allocation"]');
    const inApp = await call("GET", "/allocation/meta", { token: U });
    check("a passenger sees it in the app", inApp.status === 200 && inApp.body.staff === false, say(inApp));
    check("when it was brought up to date, not who did it", inApp.body.latest?.census?.at && !JSON.stringify(inApp.body.latest).includes("fullName") &&
      !("fileName" in (inApp.body.latest.census || {})), JSON.stringify(inApp.body.latest));
    const inAppList = await call("GET", "/allocation?from=Pa", { token: U });
    check("its pairs, without where they came from", inAppList.status === 200 && inAppList.body.items.every((i) => !("source" in i)));
    check("but not the upload history", (await call("GET", "/allocation/uploads", { token: U })).status === 403);
    check("nor the counts sheet", (await call("GET", "/allocation/counts.csv", { token: U })).status === 403);
    check("nor any change", (await call("PUT", "/allocation/pairs", { token: U, body: { train: 9301, from: "Pa", to: "Pb", status: "allocated" } })).status === 403);
    check("staff still see who uploaded what", (await call("GET", "/allocation/meta", { token: S })).body.staff === true);

    console.log("\n== the Seat Allocation tab switched off for everyone ==");
    await call("PUT", "/features/seat-allocation", { token: S, body: { state: "off_all" } });
    check("takes the public page with it", (await call("GET", "/public/allocation/status", { headers: V1 })).body.enabled === false &&
      code(await call("GET", "/public/allocation/meta", { headers: V1 })) === "PUBLIC_OFF");
    check("and what everyone signed in may see", JSON.stringify((await call("GET", "/auth/me", { token: U })).body.publicFeatures) === "[]");
    await call("PUT", "/features/seat-allocation", { token: S, body: { state: "on" } });
    check("back on, back again", (await call("GET", "/public/allocation/status", { headers: V1 })).body.enabled === true);

    console.log("\n== old visits ==");
    const old = new Date(Date.now() - 100 * 86_400_000);
    for (let i = 0; i < 4; i++) {
      await PublicVisit.create({
        kind: "list",
        outcome: i === 3 ? "sign_in" : "shown",
        ip: "192.0.2.1",
        visitorId: `visitor-old-${i % 2}-0000000`,
        query: { from: "Pa", to: null, train: null, class: null, show: "allocated", page: 1 },
        queryKey: "Pa||||",
        createdAt: old,
        updatedAt: old,
      });
    }
    // The daily sweep, run as the scheduler runs it.
    await require(`${BACKEND}/src/services/publicAllocationService`).prune();
    const days = await PublicVisitDay.findAll();
    const kept = await PublicVisit.count({ where: { ip: "192.0.2.1" } });
    check("visits older than the days kept are folded into that day's totals", days.length === 1 && days[0].requests === 4 &&
      days[0].searches === 3 && days[0].visitors === 2 && days[0].prompted === 1 && days[0].journeys?.[0]?.searches === 3,
      JSON.stringify(days.map((d) => d.toJSON())));
    check("and then deleted", kept === 0, `${kept}`);
    check("the recent ones stay", (await PublicVisit.count({ where: { visitorId: "visitor-one-0000000001" } })) > 0);
    const earlier = (await call("GET", "/allocation/public-visits", { token: S })).body.earlier;
    check("managers see the totals kept", earlier?.days === 1 && earlier.searches === 3, JSON.stringify(earlier));

    console.log("\n== the audit log, when there is one ==");
    const logged = (await call("GET", "/audit?action=allocation.public_view&limit=50", { token: S })).body;
    if (logged?.available === false) {
      console.log("  (no document store here — skipped)");
    } else {
      check("every public request is in the audit log too", (logged?.pagination?.total || 0) >= 20, JSON.stringify(logged?.pagination));
      const e = logged?.events?.find((x) => x.after?.kind === "list" && x.after?.outcome === "shown");
      check("with the visitor's address and what they searched", e?.context?.ipAddress?.startsWith("198.51.100.") && e.after.query && e.after.country === "BD",
        JSON.stringify(e));
    }
  } finally {
    await set("allocation.public_enabled", false);
    await set("allocation.public_free_searches", 5);
    await set("allocation.public_searches_per_ip_day", 200);
    await set("allocation.public_requests_per_minute", 60);
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
