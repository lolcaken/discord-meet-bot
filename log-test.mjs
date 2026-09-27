/**
 * Exercise the real logger against a throwaway log file, checking the envelope,
 * rotation trigger, and that nothing throws when the webhook is unusable.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";

const out = [];
const say = (s) => { out.push(s); writeFileSync("log-test.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(44)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const LOG_FILE = "logs/activity.log";
const before = readFileSync(LOG_FILE, "utf8");

// Hermetic: never post to the real webhook from a test. Cleared before the
// logger module is imported, since it reads the env at call time.
process.env.DISCORD_LOG_WEBHOOK_URL = "";
process.env.DISCORD_ERROR_WEBHOOK_URL = "";

const { logEvent, logMeetCreated, logBlocked, logFailure, logDenied } = await import("./src/logger.js");

say("--- envelope and levels ---");
await logEvent("info", "test.plain", { hello: "world" });
await logMeetCreated({ meetingCode: "abc-defg-hij", guildName: "Test Guild", user: "someone" });
await logBlocked({ command: "meet", retryInSeconds: 3.2, gate: "new" });
await logDenied({ command: "/end", reason: "main guild only" });
await logFailure({ command: "/meet", reason: "429 quota" });

const lines = readFileSync(LOG_FILE, "utf8").trim().split("\n").slice(-5).map((l) => JSON.parse(l));
check("logEvent wrote a line", lines[0].event, "test.plain");
check("info level recorded", lines[0].level, "info");
check("has ISO timestamp", /^\d{4}-\d{2}-\d{2}T.*Z$/.test(lines[0].ts), true);
check("meet.created event name", lines[1].event, "meet.created");
check("payload carried through", lines[1].meetingCode, "abc-defg-hij");
check("blocked is warn level", lines[2].level, "warn");
check("failure is error level", lines[4].level, "error");
check("one JSON object per line", lines.length, 5);
check("no undefined leaked into JSON", JSON.stringify(lines[0]).includes("undefined"), false);

say("\n--- rotation ---");
// Rotation is checked before each append, so the write that crosses the limit
// is the one that grows the file; the NEXT write is what rotates it.
const big = "x".repeat(1024 * 1024 + 10);
await logEvent("info", "test.rotate", { blob: big });
const rotatedYet = readdirSync("logs").includes("activity.log.1");
check("no rotation on the write that crosses the limit", rotatedYet, false);
await logEvent("info", "test.rotate.trigger", {});
const files = readdirSync("logs").filter((f) => f.startsWith("activity.log"));
check("activity.log.1 created on the next write", files.includes("activity.log.1"), true);
check("rotated file kept the big line", readFileSync("logs/activity.log.1", "utf8").includes("test.rotate"), true);
check("new log has only the trigger line", readFileSync(LOG_FILE, "utf8").trim().split("\n").length, 1);

say("\n--- resilience ---");
check("unknown level falls back to info",
  (await (async () => { await logEvent("banana", "test.level", {}); return JSON.parse(readFileSync(LOG_FILE, "utf8").trim().split("\n").pop()).level; })()), "info");
check("no webhook configured doesn't throw", true, true);

say("\n--- cleanup ---");
for (const f of readdirSync("logs").filter((f) => f.startsWith("activity.log"))) rmSync(path.join("logs", f), { force: true });
writeFileSync(LOG_FILE, before, "utf8");
say("  restored the real activity log");
for (const f of readdirSync("logs").filter((f) => f.startsWith("activity.log.") && f !== "activity.log.1")) rmSync(path.join("logs", f), { force: true });
const stillThere = readdirSync("logs").filter((f) => f.startsWith("activity.log"));
say("  log files now: " + (stillThere.length ? stillThere.join(", ") : "(none)"));

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
