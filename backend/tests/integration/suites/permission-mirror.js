// The frontend's permission keys must mirror the backend catalogue.
//
// A key the frontend lacks is `undefined` there, and the two ways it gets used
// then disagree silently: the menu treats "no permission" as "no permission
// needed" and shows the page, while the page's own hasPermission(undefined)
// is false and refuses. That is how My Returns came to say "Your account
// cannot view returns" to everybody.
const fs = require("fs");
const path = require("path");

const ROOT = require("path").resolve(__dirname, "../../../..");
let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} ${ok ? "" : detail}`);
};

const { PERMISSIONS: backend } = require(path.join(ROOT, "backend/src/constants/permissions.js"));
const src = fs.readFileSync(path.join(ROOT, "frontend/src/constants/permissions.js"), "utf8");
const frontend = {};
for (const m of src.matchAll(/^\s*([A-Z_]+): "([^"]+)"/gm)) frontend[m[1]] = m[2];

console.log("\n== the frontend mirrors the catalogue ==");
const missing = Object.keys(backend).filter((k) => !(k in frontend));
check("every backend key exists in the frontend", missing.length === 0, missing.join(", "));
const wrong = Object.entries(frontend).filter(([k, v]) => backend[k] !== v);
check("and carries the same value", wrong.length === 0, JSON.stringify(wrong));
const extra = Object.keys(frontend).filter((k) => !(k in backend));
check("and invents none of its own", extra.length === 0, extra.join(", "));

console.log("\n== every key the frontend uses is defined ==");
const used = new Set();
const walk = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith(".js")) {
      for (const m of fs.readFileSync(p, "utf8").matchAll(/PERMISSIONS\.([A-Z_]+)/g)) used.add(m[1]);
    }
  }
};
walk(path.join(ROOT, "frontend/src"));
const undefinedKeys = [...used].filter((k) => !(k in frontend));
check(`all ${used.size} referenced keys resolve`, undefinedKeys.length === 0, undefinedKeys.join(", "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
