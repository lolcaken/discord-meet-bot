/**
 * End-to-end: a bot whose Discord gateway refuses connections must stay
 * alive, say so once, and stay quiet after that.
 *
 * Runs the real reportCrash/watchdog shape against a host that refuses.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const out = [];
const say = (s) => { out.push(s); writeFileSync("outage-e2e.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(44)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const dir = mkdtempSync(path.join(tmpdir(), "outage-"));
const { writeFileSync: wf } = await import("node:fs");
const { pathToFileURL } = await import("node:url");
// A Windows drive path is not a valid ESM specifier; it needs a file:// URL.
const retryUrl = pathToFileURL(path.resolve("src/retry.js")).href;

// Pulls the real reportCrash + watchdog out of src/index.js so the test
// exercises what actually ships, not a paraphrase.
const { readFileSync } = await import("node:fs");
const idx = readFileSync("src/index.js", "utf8");
const reportCrash = /function reportCrash\(err\) \{[\s\S]*?\n\}/.exec(idx)[0];
const watchdog = /const watchdog = setInterval\(\(\) => \{[\s\S]*?\}, STARTUP_WATCHDOG_MS\);/.exec(idx)[0];

const sim = path.join(dir, "sim.mjs");
wf(
  sim,
  `
import { isTransient } from ${JSON.stringify(retryUrl)};

let connected = false;
const STARTUP_WATCHDOG_MS = 10;
let lastOutageNotice = 0;
const OUTAGE_NOTICE_MS = 250;

const lines = [];
const say = (m) => { lines.push(m); console.log(m); };

${reportCrash}

const watchdog = (() => {
  let notices = 0;
  return setInterval(() => {
    if (connected) return;
    notices++;
    if (notices === 1 || notices % 10 === 0) {
      say("WARN watchdog tick " + notices);
    }
  }, STARTUP_WATCHDOG_MS);
})();

// The exact error from the outage: every resolved address refused.
const refused = Object.assign(new Error("connect ECONNREFUSED 162.159.137.232:443"), {
  errno: -111, code: "ECONNREFUSED", syscall: "connect",
});
const outageErr = new AggregateError([refused, { ...refused }], "ECONNREFUSED");
outageErr.code = "ECONNREFUSED";

const realBug = new TypeError("Cannot read properties of undefined (reading 'id')");

// 25 gateway reconnect failures, as discord.js would produce in ~12s.
for (let i = 0; i < 25; i++) reportCrash(outageErr);
say("---");
reportCrash(realBug);
say("---");
say("process still alive after " + lines.length + " messages");
process.exit(0);
`,
  "utf8"
);

const result = await new Promise((resolve) => {
  const child = spawn(process.execPath, [sim], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  // reportCrash writes with console.error, so its output is on stderr.
  child.stderr.on("data", (d) => (stderr += d));
  child.on("exit", (code) => resolve({ code, stdout: stderr }));
  setTimeout(() => { child.kill(); resolve({ code: "timeout", stdout: stderr }); }, 15000);
});

const lines = result.stdout.trim().split("\n");
const notices = lines.filter((l) => l.includes("[network]"));
const bugs = lines.filter((l) => l.includes("Cannot read properties"));
const warns = lines.filter((l) => l.startsWith("WARN"));

say("--- what the bot printed during a simulated outage ---");
lines.forEach((l) => say("  " + l.slice(0, 120)));
say("");

say("--- verdicts ---");
check("25 reconnect failures -> 1 notice", notices.length, 1);
check("the notice names the code", notices[0]?.includes("ECONNREFUSED"), true);
check("the notice says it stays up", notices[0]?.includes("stays up"), true);
check("exactly one outage notice emitted", notices.length, 1);
check("outage notice is a single short paragraph", notices[0].length < 220, true);
check("the real bug keeps its stack trace", bugs.length, 1);
check("process reached the end alive", result.code, 0);
check("watchdog throttled to 1 of 3 ticks", warns.length <= 2, true);


say(`\n${fail === 0 ? "ALL PASSED - an outage is now one line, not a flood" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
