const test = require("node:test");
const assert = require("node:assert/strict");

const { originPolicy } = require("../../src/utils/allowedOrigin");

const LIVE = "https://seat-planner-sable.vercel.app";
const PREVIEWS = "https://seat-planner-*-ashikuzzaman-kanons-projects.vercel.app";
const production = originPolicy([LIVE, PREVIEWS], { production: true });

test("a listed origin is allowed, and only that origin", () => {
  assert.equal(production(LIVE), true);
  assert.equal(production("https://seat-planner-sable.vercel.app.evil.com"), false);
  assert.equal(production("http://seat-planner-sable.vercel.app"), false);
  assert.equal(production("https://seat-planner-sable.vercel.app:8443"), false);
});

test("a preview pattern lets in every branch and every deploy of the project", () => {
  assert.equal(production("https://seat-planner-git-phase9-tests-ci-ashikuzzaman-kanons-projects.vercel.app"), true);
  assert.equal(production("https://seat-planner-4fk2a9xq1-ashikuzzaman-kanons-projects.vercel.app"), true);
});

test("the star stands for one piece of a host name, never a dot", () => {
  assert.equal(production("https://seat-planner-x.evil.com-ashikuzzaman-kanons-projects.vercel.app"), false);
  assert.equal(production("https://seat-planner--ashikuzzaman-kanons-projects.vercel.app"), false, "empty");
  assert.equal(production("https://other-app-ashikuzzaman-kanons-projects.vercel.app"), false, "another project");
  assert.equal(production("https://seat-planner-x-ashikuzzaman-kanons-projects.vercel.app.evil.com"), false);
  assert.equal(production("http://seat-planner-x-ashikuzzaman-kanons-projects.vercel.app"), false, "plain http");
});

test("the rest of a pattern is literal text, not a regular expression", () => {
  const allowed = originPolicy(["https://*.example.com"], { production: true });
  assert.equal(allowed("https://shop.example.com"), true);
  assert.equal(allowed("https://shopXexample.com"), false);
  assert.equal(allowed("https://a.b.example.com"), false);
});

test("host names are compared without regard to case", () => {
  assert.equal(production("https://Seat-Planner-Sable.vercel.app"), true);
  assert.equal(originPolicy(["HTTPS://APP.EXAMPLE.COM"], { production: true })("https://app.example.com"), true);
});

test("production trusts nothing it was not told to", () => {
  assert.equal(production("http://localhost:3000"), false);
  assert.equal(production("http://192.168.0.105:3000"), false);
  assert.equal(production("https://abc.trycloudflare.com"), false);
});

test("in development, tunnels and machines on the same network are let in", () => {
  const dev = originPolicy(["http://localhost:3000"], { production: false });
  assert.equal(dev("http://192.168.0.105:3000"), true);
  assert.equal(dev("http://172.20.1.4:3000"), true);
  assert.equal(dev("https://abc.trycloudflare.com"), true);
  assert.equal(dev("http://172.32.0.1:3000"), false, "172.32 is public");
  assert.equal(dev("https://example.com"), false);
  assert.equal(dev("not a url"), false);
});
