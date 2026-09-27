/**
 * Cooldown gate behaviour, executed against the helpers sliced straight out of
 * src/index.js so this tests the shipped logic rather than a copy of it.
 */
import { readFileSync, writeFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync("cooldown-test.txt", out.join("\n") + "\n", "utf8"); };

const src = readFileSync("src/index.js", "utf8");
const lines = src.split("\n");
const start = lines.findIndex((l) => l.includes("const MEET_COOLDOWN_S"));
const stop = lines.findIndex((l, i) => i > start && l.includes("async function takeMeetingWithCooldown"));
let end = stop;
while (end > start && (lines[end - 1].trim() === "" || lines[end - 1]?.trim().startsWith("/**"))) end--;
const code = lines.slice(start, end).join("\n");

if (!code.includes("cooldownRemaining") || !code.includes("markPosted")) {
  say("could not extract the cooldown helpers");
  say(code);
  process.exit(1);
}
say(`=== extracted lines ${start + 1}-${end} from src/index.js ===`);

let clock = 1_000_000;
const FakeDate = { now: () => clock };
const { cooldownRemaining, markPosted, MEET_COOLDOWN_S } = new Function(
  "Date",
  `${code}\nreturn { cooldownRemaining, markPosted, MEET_COOLDOWN_S };`
)(FakeDate);

say(`=== MEET_COOLDOWN_S = ${MEET_COOLDOWN_S} ===\n`);

let fail = 0;
const check = (label, got, want, ok) => {
  const pass = ok ?? Math.abs(got - want) < 0.01;
  if (!pass) fail++;
  say(`  ${pass ? "PASS" : "FAIL"}  ${label.padEnd(50)} got ${typeof got === "number" ? got.toFixed(2) : got}`);
};

say("--- a fresh channel is always allowed ---");
check("no posts yet", cooldownRemaining("new", "A"), 0, cooldownRemaining("new", "A") === 0);
check("no posts yet (preloaded gate)", cooldownRemaining("preloaded", "A"), 0, cooldownRemaining("preloaded", "A") === 0);

say("\n--- inside 5s it's blocked, and the wait shrinks ---");
const t0 = clock;
markPosted("new", "A");
check("immediately after posting", cooldownRemaining("new", "A"), 5, cooldownRemaining("new", "A") > 4.9);
for (const t of [1, 2, 3, 4, 4.9]) {
  clock = t0 + t * 1000;
  check(`at t+${t}s`, cooldownRemaining("new", "A"), 5 - t, Math.abs(cooldownRemaining("new", "A") - (5 - t)) < 0.01);
}
clock = t0 + 5000;
check("at t+5.0s", cooldownRemaining("new", "A"), 0, cooldownRemaining("new", "A") === 0);

say("\n--- the two gates are independent ---");
markPosted("preloaded", "B");
check("preloaded blocked after a preloaded post", cooldownRemaining("preloaded", "B"), 5, cooldownRemaining("preloaded", "B") > 4.9);
check("...but 'new' is NOT blocked by it", cooldownRemaining("new", "B"), 0, cooldownRemaining("new", "B") === 0);
markPosted("new", "C");
check("new blocked after a new post", cooldownRemaining("new", "C"), 5, cooldownRemaining("new", "C") > 4.9);
check("...but 'preloaded' is NOT blocked by it", cooldownRemaining("preloaded", "C"), 0, cooldownRemaining("preloaded", "C") === 0);

say("\n--- per channel, not global ---");
const tD = clock;
markPosted("new", "D");
check("channel D blocked", cooldownRemaining("new", "D"), 5, cooldownRemaining("new", "D") > 4.9);
clock = tD + 6000; // let D's own cooldown fully expire
markPosted("new", "E");
check("channel E blocked", cooldownRemaining("new", "E"), 5, cooldownRemaining("new", "E") > 4.9);
check("channel D expired, unaffected by E", cooldownRemaining("new", "D"), 0, cooldownRemaining("new", "D") === 0);

say("\n--- burst of 10 on each gate: only the first passes ---");
clock = t0 + 12000;
for (const gate of ["new", "preloaded"]) {
  let allowed = 0;
  for (let i = 0; i < 10; i++) {
    if (cooldownRemaining(gate, "BURST") === 0) { allowed++; markPosted(gate, "BURST"); }
  }
  check(`${gate}: allowed out of 10 rapid attempts`, allowed, 1, allowed === 1);
}

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
