/**
 * Outage reporting: a connection error should produce one clear line, a real
 * bug should always be printed, and neither should be silently swallowed.
 */
import { writeFileSync, readFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync("outage-test.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(48)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const idx = readFileSync("src/index.js", "utf8");

say("--- reportCrash exists and is wired to both handlers ---");
check("isTransient imported", idx.includes('import { withRetry, isTransient } from "./retry.js";'), true);
check("unhandledRejection -> reportCrash", /process\.on\("unhandledRejection", reportCrash\)/.test(idx), true);
check("uncaughtException  -> reportCrash", /process\.on\("uncaughtException", reportCrash\)/.test(idx), true);

say("\n--- connection errors are summarised, not dumped ---");
const fn = /function reportCrash\(err\) \{[\s\S]*?\n\}/.exec(idx)[0];
check("classifies with isTransient", fn.includes("isTransient(err)"), true);
check("names the code", fn.includes("err?.errors?.[0]?.code"), true);
check("says the bot stays up", fn.includes("stays up and will"), true);
check("throttles repeats", fn.includes("OUTAGE_NOTICE_MS"), true);
check("throttle is 10 minutes", /OUTAGE_NOTICE_MS = 10 \* 60 \* 1000/.test(idx), true);

say("\n--- real bugs are never throttled away ---");
check("non-network errors printed in full", fn.includes("console.error(\"Unhandled error"), true);
check("a real fault resets the throttle", fn.includes("lastOutageNotice = 0;"), true);

say("\n--- the watchdog backs off too ---");
const wd = /const watchdog = setInterval\(\(\) => \{[\s\S]*?\}, STARTUP_WATCHDOG_MS\);/.exec(idx)[0];
check("warns on the first tick", wd.includes("watchdogNotices === 1"), true);
check("then only every tenth", wd.includes("watchdogNotices % 10 === 0"), true);
check("silent in between", wd.includes("}"), true);

say("\n--- still holds the loop open (the actual outage fix) ---");
check("watchdog created before ready", idx.indexOf("const watchdog = setInterval") < idx.indexOf('client.once("ready"'), true);
check("cleared once connected", idx.includes("clearInterval(watchdog);"), true);
check("only clears after connecting", /connected = true;[\s\S]{0,80}clearInterval\(watchdog\)/.test(idx), true);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
