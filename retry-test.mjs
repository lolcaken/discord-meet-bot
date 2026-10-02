/**
 * Retry behaviour across both upstreams: Google (429s, connect timeouts) and
 * Cloudflare-fronted Discord (refused connections).
 *
 * The classifier lives in src/retry.js and is shared by googleMeet.js and
 * index.js, so these assertions read each concern from the file that owns it
 * rather than re-implementing anything.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { isTransient } from "./src/retry.js";

const out = [];
const say = (s) => { out.push(s); writeFileSync("retry-test.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(50)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const retrySrc = readFileSync("src/retry.js", "utf8");
const meetSrc = readFileSync("src/googleMeet.js", "utf8");
const idxSrc = readFileSync("src/index.js", "utf8");
const poolSrc = readFileSync("src/meetingPool.js", "utf8");
const logSrc = readFileSync("src/logger.js", "utf8");

const codes = /const TRANSIENT_CODES = new Set\(\[([^\]]*)\]\);/.exec(retrySrc)[1];
say(`TRANSIENT_CODES = [${codes}]  (src/retry.js)\n`);

const netError = (code) => {
  const e = new TypeError("fetch failed");
  e.cause = { code };
  e.code = code;
  return e;
};

say("--- the exact AggregateError from the Discord failure ---");
// Node builds this when every address for a host refuses, which is what a
// Cloudflare-unreachable box produces.
const refused = Object.assign(new Error("connect ECONNREFUSED 162.159.138.232:443"), {
  errno: -111, code: "ECONNREFUSED", syscall: "connect",
});
const agg = new AggregateError([refused, { ...refused, message: "second address" }], "ECONNREFUSED");
agg.code = "ECONNREFUSED";
check("AggregateError of refusals is transient", isTransient(agg), true);

say("\n--- plain network errors ---");
for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "UND_ERR_CONNECT_TIMEOUT"]) {
  check(code, isTransient(netError(code)), true);
}

say("\n--- transient HTTP statuses ---");
for (const status of [408, 425, 429, 500, 502, 503, 504]) {
  const e = new Error(`HTTP ${status}`);
  e.status = status;
  check(`HTTP ${status}`, isTransient(e), true);
}

say("\n--- genuine mistakes still fail fast ---");
for (const status of [400, 401, 403, 404]) {
  const e = new Error(`HTTP ${status}`);
  e.status = status;
  check(`HTTP ${status} not retried`, isTransient(e), false);
}
check("Discord's UnknownError not retried", isTransient(new Error("Unknown interaction")), false);
check("a parse error not retried", isTransient(new SyntaxError("Unexpected token")), false);
check("an unknown error not retried", isTransient(new Error("something else")), false);

say("\n--- bounded, and only one classifier ---");
check("MAX_ATTEMPTS is small", Number(/const MAX_ATTEMPTS = (\d+);/.exec(retrySrc)[1]) <= 4, true);
check("requests carry a timeout", /REQUEST_TIMEOUT_MS/.test(meetSrc), true);
check("googleMeet defines no second classifier", meetSrc.includes("function isTransient"), false);
check("googleMeet imports the shared one", meetSrc.includes('from "./retry.js"'), true);

say("\n--- Google calls retry ---");
check("createOpenMeetSpace retries", /createOpenMeetSpace[\s\S]{0,200}withRetry/.test(meetSrc), true);
check("call() retries", /async function call[\s\S]{0,200}withRetry/.test(meetSrc), true);

say("\n--- Discord replies retry and get logged ---");
const helper = /async function safeReply[\s\S]*?\n\}/.exec(idxSrc)[0];
check("safeReply uses withRetry", helper.includes("withRetry("), true);
check("still never throws", helper.includes("return undefined"), true);
check("failure is logged, not just printed", helper.includes("logFailure("), true);
check("failure is attributed", helper.includes("discord.reply"), true);

say("\n--- the pool heals instead of waiting for a user ---");
check("heal scheduled on a short pool", /if \(ready < POOL_SIZE\)/.test(poolSrc), true);
check("heal retries a few times", /scheduleHeal\(attemptsLeft - 1\)/.test(poolSrc), true);
check("heal stops once full", /if \(deficit <= 0\) return;/.test(poolSrc), true);
check("heal timer is unref'd", /healTimer\.unref\?\.\(\)/.test(poolSrc), true);

say("\n--- webhook failure is described, not bare ---");
check("reports the network code", /Webhook log failed \(\$\{code/.test(logSrc), true);
check("counts repeat blips", logSrc.includes("webhookBlips === 5"), true);
check("asks the useful question", logSrc.includes("able to reach Discord at all"), true);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
