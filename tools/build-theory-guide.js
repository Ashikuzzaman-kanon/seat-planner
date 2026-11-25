/**
 * Builds docs/goals/theory.md: every theory study page in one document, in study order.
 *
 *   node tools/build-theory-guide.js           write it
 *   node tools/build-theory-guide.js --check   only say whether it is up to date (exit 1 if not)
 *
 * The pages in docs/goals/ stay the source. Edit a page and run this again; never edit theory.md by hand.
 * generate-guides.js runs it too, so the usual command rebuilds everything.
 *
 * What changes on the way in: each page becomes a "Part" with its headings one level down, links between
 * the pages become links inside the document (repeated headings get new -1, -2 ... suffixes, so every
 * anchor is worked out again), and the few sentences that say "this page" say "this part". The debugging
 * demo is a runbook for a live demo, not theory, so it stays a page of its own.
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "../docs/goals");
const OUT = path.join(DIR, "theory.md");

// Study order, as in docs/goals/README.md.
const PAGES = [
  "deployment-basic.md",
  "docker-advanced.md",
  "deployment-security.md",
  "deployment-monitoring-logging.md",
  "deployment-rollback-dr.md",
  "deployment-best-practices.md",
  "jenkins.md",
  "ai-productivity.md",
];

// Sentences that name the page they are on. Each must still be there, once, or the build stops.
const REWORDING = {
  "deployment-basic.md": [["This page fills in the rest", "This part fills in the rest"]],
  "docker-advanced.md": [
    ["first; this page assumes", "first; this part assumes"],
    ["(see the note at the top of the basics page)", "(see the note at the start of Part 1)"],
    ["The numbers on this page were measured", "The numbers in this part were measured"],
    ["And the out-of-memory kill, from the basics page:", "And the out-of-memory kill, from Part 1:"],
  ],
  "deployment-security.md": [
    ["(non-root images, scanning, capabilities) is on", "(non-root images, scanning, capabilities) is in"],
    ["This page is the wider picture", "This part is the wider picture"],
  ],
  "deployment-monitoring-logging.md": [["a single container's logs is on", "a single container's logs is in"]],
  "deployment-best-practices.md": [
    ["This page ties the other study pages together into one checklist.", "This part ties the other parts together into one checklist."],
  ],
  "ai-productivity.md": [["So this page is a **summary**", "So this part is a **summary**"]],
};

const WORDS_PER_MINUTE = 180; // careful reading of technical text

/* ---------- headings and anchors, as GitHub makes them ---------- */

const plain = (md) => md.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "");

// A fresh slugger per document: the first "Key ideas" is #key-ideas, the next #key-ideas-1, and so on.
function slugger() {
  const seen = new Map();
  return (title) => {
    const base = plain(title).trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

// Each line, with whether it is inside a fenced code block and, for a heading, its level and text.
function parse(text) {
  let fence = false;
  return text.split("\n").map((line) => {
    const isFence = /^\s*```/.test(line);
    const inCode = fence || isFence;
    if (isFence) fence = !fence;
    const m = !inCode && /^(#{1,6}) (.+)$/.exec(line);
    return { line, inCode, level: m ? m[1].length : 0, title: m ? m[2].trim() : null };
  });
}

/* ---------- build ---------- */

function build() {
  const read = (file) => fs.readFileSync(path.join(DIR, file), "utf8").replace(/\r\n/g, "\n");
  const anchor = slugger(); // over theory.md, called in the order the headings appear in it
  const anchors = new Map(); // "page.md" and "page.md#old-anchor" -> the anchor in theory.md
  anchor("Theory study guide");
  anchor("How to use this guide");
  const contentsAnchor = anchor("Contents");

  const parts = PAGES.map((file, i) => {
    let text = read(file);
    for (const [from, to] of REWORDING[file] || []) {
      if (text.split(from).length !== 2) throw new Error(`${file}: "${from}" is not there exactly once; update REWORDING`);
      text = text.replace(from, to);
    }
    const lines = parse(text.replace(/\n+$/, ""));
    const levels = [...new Set(lines.filter((l) => l.level).map((l) => l.level))].sort();
    if (lines.find((l) => l.level).level !== 1) throw new Error(`${file}: must start with its # title`);

    // Headings: the page's levels in use become 2, 3, 4 ..., so a page that goes # then ### has no gap.
    const old = slugger();
    let title;
    const subTopics = [];
    const sentences = []; // [sub-topic title, its anchor, the "In one sentence" paragraph]
    for (const l of lines) {
      if (!l.level) continue;
      const was = old(l.title);
      l.level = 2 + levels.indexOf(l.level);
      if (l.level === 2) {
        title = l.title;
        l.title = `Part ${i + 1}: ${l.title}`;
      }
      l.anchor = anchor(l.title);
      anchors.set(`${file}#${was}`, l.anchor);
      if (l.level === 2) anchors.set(file, l.anchor);
      if (l.level === 3 && levels.includes(2)) subTopics.push({ title: l.title, anchor: l.anchor });
    }
    const goal = (/^Goal: \*\*(.+?)\*\*/m.exec(text) || [])[1];
    if (!goal) throw new Error(`${file}: no "Goal: **...**" line`);
    return { file, title, goal, lines, subTopics, sentences, partAnchor: anchors.get(file) };
  });
  const revision = anchor("Revision sheet");

  // Links: to another study page or a heading on one -> inside this document; anything else stays as it is.
  const relink = (file, line) =>
    line.replace(/\]\(([^)\s]+)\)/g, (all, target) => {
      if (/^(https?:|mailto:)/.test(target)) return all;
      const [page, hash] = target.split("#");
      if (page && !PAGES.includes(page)) return all; // code, other docs, the debugging runbook
      const key = hash ? `${page || file}#${hash}` : page;
      if (!anchors.has(key)) throw new Error(`${file}: link to ${target}, which is not a heading`);
      return `](#${anchors.get(key)})`;
    });

  for (const p of parts) {
    let current = { title: p.title, anchor: p.partAnchor };
    p.lines.forEach((l, n) => {
      if (l.inCode) return;
      if (l.level) {
        l.line = `${"#".repeat(l.level)} ${l.title}`;
        if (p.subTopics.some((s) => s.anchor === l.anchor)) current = { title: l.title, anchor: l.anchor };
        if (l.title === "In one sentence") {
          const para = [];
          for (let k = n + 1; k < p.lines.length && !(para.length && !p.lines[k].line.trim()); k++) {
            if (p.lines[k].line.trim()) para.push(p.lines[k].line.trim());
          }
          p.sentences.push([current.title, current.anchor, para.join(" ")]);
        }
        return;
      }
      l.line = relink(p.file, l.line);
    });
    for (const s of p.sentences) s[2] = relink(p.file, s[2]);
  }

  /* ---------- the parts around the pages ---------- */

  const index = read("README.md");
  const section = (name) => {
    const m = new RegExp(`^## ${name}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(index);
    if (!m) throw new Error(`README.md: no "## ${name}" section`);
    return m[1].trim();
  };
  const layout = section("How each sub-topic is laid out").split("\n").filter((l, i, all) => {
    // Only the numbered list: from "1." to the blank line after the last item.
    const start = all.findIndex((x) => /^1\. /.test(x));
    const end = all.findIndex((x, k) => k > start && !x.trim());
    return i >= start && i < (end < 0 ? all.length : end);
  });
  const presenting = section("Presenting a theory topic");

  const goals = [...new Set(parts.map((p) => p.goal))];
  const body = parts.map((p) => p.lines.map((l) => l.line).join("\n"));
  const words = body.join(" ").split(/\s+/).filter(Boolean).length;
  const hours = Math.round((words / WORDS_PER_MINUTE / 60) * 2) / 2;
  const list = (names) => names.map((n) => `*${n}*`).join(names.length > 2 ? ", " : " and ").replace(/, ([^,]*)$/, " and $1");

  const contents = [
    "| Part | Topic | Sub-goals | Goal |",
    "|---|---|---|---|",
    ...parts.map(
      (p, i) =>
        `| ${i + 1} | [${p.title}](#${p.partAnchor}) | ` +
        `${p.subTopics.length ? p.subTopics.map((s) => `[${s.title}](#${s.anchor})`).join(" · ") : "The whole part"} | ${p.goal} |`,
    ),
    `| | [Revision sheet](#${revision}) | Every sub-topic in one sentence | |`,
  ];

  const doc = [
    "<!-- Generated by tools/build-theory-guide.js from the study pages in this folder. Edit those pages, then run it; do not edit this file. -->",
    "",
    "# Theory study guide",
    "",
    "Everything to learn for the theory demos, in one document, in the order to study it:",
    `the open sub-goals of ${list(goals)}.`,
    "",
    `About ${(Math.round(words / 1000) * 1000).toLocaleString("en-US")} words: roughly ${hours} hours of reading, longer with the exercises.`,
    "Each part stands on its own, so it can be read one sitting at a time.",
    "",
    "The debugging demo is live, not theory, so it is not in here. Its runbook is [debugging-demo.md](debugging-demo.md).",
    "",
    `## How to use this guide`,
    "",
    "Every sub-topic is laid out the same way, so you always know where to look:",
    "",
    ...layout,
    "",
    "Jenkins and the AI goal leave out the parts that do not fit. The first three Jenkins sub-topics have no",
    "exercises (two have a worked example instead), and the AI sub-topics draw on this project's own history",
    "instead of *At larger scale* and *Common mistakes*.",
    "",
    "When you present:",
    "",
    presenting,
    "",
    "The same material is also in separate pages, one per part, in this folder ([index](README.md)). This document",
    "is built from them, so the two always match.",
    "",
    "## Contents",
    "",
    ...contents,
    ...parts.flatMap((p, i) => ["", "---", "", body[i], "", `[Back to contents](#${contentsAnchor})`]),
    "",
    "---",
    "",
    "## Revision sheet",
    "",
    "Every sub-topic in one sentence, for a last read before you present. Each name opens its section.",
    ...parts.flatMap((p, i) => ["", `**Part ${i + 1}: ${p.title}**`, "", ...p.sentences.map(([t, a, s]) => `- [${t}](#${a}): ${s}`)]),
    "",
  ].join("\n");

  // Every link inside the document lands on a heading, and every relative file link on a file.
  const headings = new Set();
  const check = slugger();
  for (const l of parse(doc)) if (l.level) headings.add(check(l.title));
  for (const l of parse(doc)) {
    if (l.inCode) continue;
    for (const [, target] of l.line.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [file, hash] = target.split("#");
      if (!file && !headings.has(hash)) throw new Error(`theory.md: #${hash} is not a heading`);
      if (file && !fs.existsSync(path.resolve(DIR, file))) throw new Error(`theory.md: ${file} is not there`);
    }
  }
  return { doc, words, parts: parts.length, sentences: parts.reduce((n, p) => n + p.sentences.length, 0) };
}

function write() {
  const { doc, words, parts, sentences } = build();
  fs.writeFileSync(OUT, doc);
  console.log(`theory.md: ${parts} parts, ${sentences} sub-topics on the revision sheet, ${words.toLocaleString("en-US")} words`);
}

if (require.main === module) {
  if (process.argv.includes("--check")) {
    // Git on Windows may have checked it out with CRLF line endings; that is not a difference.
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") === build().doc;
    console.log(same ? "theory.md is up to date" : "theory.md is out of date: run node tools/build-theory-guide.js");
    process.exit(same ? 0 : 1);
  }
  write();
}

module.exports = { build, write };
