/**
 * End-to-end check that typed `cd` lands on the hardcoded link, using the real
 * parser and the real slot regex taken out of src/index.js.
 */
import { parseTextCommand } from "./src/textCommands.js";
import { PRELOADED_MEETS } from "./src/preloadedMeets.js";
import { readFileSync, writeFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync("cd-test.txt", out.join("\n") + "\n", "utf8"); };

// The real regex from the shipped handler, not a re-implementation.
const src = readFileSync("src/index.js", "utf8");
const m = /const slot = (\/\^meet.*?\/[a-z]*)\.exec\(name\)/.exec(src);
const slotRe = new RegExp(m[1].slice(1, -1));
say(`handler slot regex: ${m[1]}\n`);

let fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} -> ${got}`);
};

say("=== typed command -> link the bot would post ===");
for (const typed of ["cd", "meet", "!cd", "CD", "meet2", "meet3", "meet4", "rand"]) {
  const parsed = parseTextCommand(typed);
  if (!parsed) { say(`  FAIL  ${typed} did not parse`); fail++; continue; }

  const name = parsed.name;
  const sm = slotRe.exec(name);
  let result;
  if (sm) {
    result = `https://meet.google.com/${PRELOADED_MEETS[sm[1] ?? "1"]}`;
  } else {
    result = "RANDOM (pooled)";
  }
  say(`  ${typed.padEnd(8)} parses as "${name}"`.padEnd(34) + `-> ${result}`);
}

say("\n=== assertions ===");
const linkFor = (t) => {
  const p = parseTextCommand(t);
  if (!p) return null;
  const sm = slotRe.exec(p.name);
  return sm ? PRELOADED_MEETS[sm[1] ?? "1"] : "RANDOM";
};

check("cd gives the same link as meet", linkFor("cd"), linkFor("meet"));
check("cd gives tgc-rzea-btb", linkFor("cd"), "tgc-rzea-btb");
check("meet still gives tgc-rzea-btb", linkFor("meet"), "tgc-rzea-btb");
check("cd is hardcoded, not random", linkFor("cd") !== "RANDOM", true);
check("rand stays random", linkFor("rand"), "RANDOM");
check("meet2 unaffected", linkFor("meet2"), "tif-juqf-tsx");

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
