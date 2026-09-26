/**
 * Cooldown gate behaviour. Replicates the helper straight from the source so
 * this tests the shipped logic, not a reimplementation of it.
 */
import { readFileSync, writeFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync("cooldown-test.txt", out.join("\n") + "\n", "utf8"); };

const src = readFileSync("src/index.js", "utf8");

// Slice the helper block out of the source, so this tests the shipped logic
// rather than a reimplementation of it.
const lines = src.split("\n");
const start = lines.findIndex((l) => l.includes("const MEET_COOLDOWN_S"));
// The block ends at the line before the takeMeetingWithCooldown doc comment.
const stop = lines.findIndex((l, i) => i > start && l.includes("async function takeMeetingWithCooldown"));
let end = stop;
while (end > start && lines[end - 1].trim() === "" || lines[end - 1]?.trim().startsWith("/**")) end--;
const code = lines.slice(start, end).join("\n");

if (!code.includes("cooldownRemaining") || !code.includes("markMeetCreated")) {
  say("could not extract the cooldown helpers from src/index.js");
  say(code);
  process.exit(1);
}
say(`=== extracted lines ${start + 1}-${end} from src/index.js ===`);

let clock = 1_000_000;
const FakeDate = { now: () => clock };

const factory = new Function(
  "Date",
  `${code}\nreturn { cooldownRemaining, markMeetCreated, MEET_COOLDOWN_S };`
);
const { cooldownRemaining, markMeetCreated, MEET_COOLDOWN_S } = factory(FakeDate);

say(`=== extracted from source: MEET_COOLDOWN_S = ${MEET_COOLDOWN_S} ===\n`);

let fail = 0;
const check = (label, got, want, ok) => {
  const pass = ok ?? Math.abs(got - want) < 0.01;
  if (!pass) fail++;
  say(`  ${pass ? "PASS" : "FAIL"}  ${label.padEnd(46)} got ${typeof got === "number" ? got.toFixed(2) : got}`);
};

say("--- first request in a channel is always allowed ---");
check("fresh channel, nothing made yet", cooldownRemaining("A"), 0, cooldownRemaining("A") === 0);

say("\n--- a second request inside 5s is blocked ---");
const t0 = clock;
markMeetCreated("A");
const immediate = cooldownRemaining("A");
check("immediately after creating", immediate, 5, immediate > 4.9);

say("\n--- the wait shrinks as time passes (absolute elapsed time) ---");
markMeetCreated("T");
for (const elapsed of [1, 2, 3, 4, 4.9]) {
  clock = t0 + elapsed * 1000; // absolute, not cumulative
  const left = cooldownRemaining("T");
  const want = 5 - elapsed;
  check(`at t+${elapsed}s`, left, want, Math.abs(left - want) < 0.01);
}
check("at t+5.0s", (clock = t0 + 5000, cooldownRemaining("T")), 0, cooldownRemaining("T") === 0);

say("\n--- the gate is per channel, not global ---");
markMeetCreated("B");
check("channel B blocked right after its own create", cooldownRemaining("B"), 5, cooldownRemaining("B") > 4.9);
clock += 6000;
markMeetCreated("C");
check("channel A unaffected while C is on cooldown", cooldownRemaining("A"), 0, cooldownRemaining("A") === 0);
check("channel C blocked", cooldownRemaining("C"), 5, cooldownRemaining("C") > 4.9);

say("\n--- burst of 10 in the same channel: only the first is allowed ---");
clock += 6000;
const chan = "BURST";
let allowed = 0;
for (let i = 0; i < 10; i++) {
  if (cooldownRemaining(chan) === 0) { allowed++; markMeetCreated(chan); }
}
check("allowed out of 10 rapid attempts", allowed, 1, allowed === 1);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
