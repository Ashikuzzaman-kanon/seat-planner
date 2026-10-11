const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests";
process.env.APP_URL = "https://app.example.test";

const ui = require("../../src/emails/layout");

test("text from a template's caller is escaped, so it cannot become markup", () => {
  const html = ui.details([["Passenger", `<script>alert("x")</script> & co`]]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; co/);
});

test("markup a template writes itself passes through when marked trusted", () => {
  const html = ui.paragraph(ui.trusted(`Reference ${ui.esc(ui.strong("ABC123"))}`));
  assert.match(html, /<strong[^>]*>ABC123<\/strong>/);
});

test("trusted bold text still escapes what is inside it", () => {
  assert.match(ui.esc(ui.strong("<b>")), /&lt;b&gt;/);
});

test("empty rows are left out rather than shown as blanks", () => {
  const html = ui.details([["Shown", "yes"], ["Hidden", null], ["Also hidden", ""], ["Zero is a value", 0]]);
  assert.match(html, /Shown/);
  assert.doesNotMatch(html, /Hidden/);
  assert.match(html, /Zero is a value/);
  assert.equal(ui.details([["Only", undefined]]), "");
});

test("amounts read as money, with the taka sign and thousands separated", () => {
  assert.equal(ui.taka(183040), "৳ 1,830.40");
  assert.equal(ui.taka(5), "৳ 0.05");
  assert.equal(ui.taka(null), "৳ 0.00");
});

test("buttons point into the web app, with the address written out beneath", () => {
  const html = ui.button("View your tickets", ui.appUrl("/dashboard/bookings"));
  assert.match(html, /href="https:\/\/app\.example\.test\/dashboard\/bookings"/);
  assert.match(html, /Or open/);
});

test("a one-time code is spaced for reading", () => {
  assert.match(ui.code("482913"), /482 913/);
});

test("the page carries the brand, the title and a hidden preview line", () => {
  const html = ui.page({ subject: "S", preheader: "Seen in the inbox list", eyebrow: "Kind", title: "The title", body: "<p>x</p>" });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Seat Planner/);
  assert.match(html, /The title/);
  assert.match(html, /display:none[^>]*>Seen in the inbox list/);
  assert.match(html, /https:\/\/app\.example\.test\/apple-icon\.png/);
});

test("the plain-text version keeps the words and the links, and drops the markup", () => {
  const html = ui.page({
    subject: "S",
    title: "Your return is paid",
    body: ui.details([["Credited", "৳ 10.00"]]) + ui.button("See your returns", "https://app.example.test/dashboard/refunds"),
  });
  const text = ui.toText(html);
  assert.doesNotMatch(text, /<[a-z]/i);
  assert.match(text, /Your return is paid/);
  assert.match(text, /Credited/);
  assert.match(text, /৳ 10\.00/);
  assert.match(text, /See your returns → \(https:\/\/app\.example\.test\/dashboard\/refunds\)/);
  assert.doesNotMatch(text, /&amp;|&nbsp;|&rarr;/);
});
