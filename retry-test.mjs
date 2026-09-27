/**
 * Retry behaviour for transient Google failures, and the pool heal. The
 * transient classifier is exercised against the real error shape from the log.
 */
import { writeFileSync, readFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync("retry-test.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(50)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const src = readFileSync("src/googleMeet.js", "utf8");

// Pull the classifier and its table straight out of the shipped source.
const codes = /const TRANSIENT_CODES = new Set\(\[([^\]]*)\]\);/.exec(src)[1];
const classifier = /function isTransient\(err\) \{[\s\S]*?\n\}/.exec(src)[0];

const TRANSIENT = new Set(codes.split(",").map((s) => Number(s.trim())));
// The classifier body is lifted verbatim and closed over the same set, so this
// tests the shipped logic rather than a paraphrase of it.
const isTransient = new Function(
  "TRANSIENT_CODES",
  `${classifier}\nreturn isTransient;`
)(TRANSIENT);

say(`TRANSIENT_CODES = [${codes}]\n`);

say("--- the exact error from the server log is transient ---");
// undici connect timeout: TypeError('fetch failed') with .cause.code
const connectTimeout = new TypeError("fetch failed");
connectTimeout.cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
connectTimeout.code = "UND_ERR_CONNECT_TIMEOUT";
check("connect timeout is retried", isTransient(connectTimeout), true);

say("\n--- other network failures are retried ---");
for (const code of ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_SOCKET"]) {
  const e = new TypeError("fetch failed");
  e.cause = { code };
  e.code = code;
  check(`${code} is retried`, isTransient(e), true);
}

say("\n--- transient HTTP statuses are retried ---");
for (const status of [408, 425, 429, 500, 502, 503, 504]) {
  const e = new Error(`Google Meet API error (${status})`);
  e.status = status;
  check(`HTTP ${status} is retried`, isTransient(e), true);
}

say("\n--- real mistakes are NOT retried (no point asking again) ---");
for (const status of [400, 401, 403, 404]) {
  const e = new Error(`Google Meet API error (${status})`);
  e.status = status;
  check(`HTTP ${status} fails fast`, isTransient(e), false);
}
const badJson = new SyntaxError("Unexpected token < in JSON");
check("a parse error fails fast", isTransient(badJson), false);
const plain = new Error("something else entirely");
check("an unknown error fails fast", isTransient(plain), false);

say("\n--- retries are bounded ---");
const attempts = /const MAX_ATTEMPTS = (\d+);/.exec(src);
check("MAX_ATTEMPTS is small", Number(attempts[1]) <= 4, true);
const timeout = /const REQUEST_TIMEOUT_MS = ([\d_]+);/.exec(src);
check("requests have a timeout", Number(timeout[1].replace(/_/g, "")) >= 15000, true);
check("createOpenMeetSpace retries", /createOpenMeetSpace[\s\S]{0,200}withRetry/.test(src), true);
check("call() retries", /async function call[\s\S]{0,200}withRetry/.test(src), true);

say("\n--- the pool heals instead of waiting for a user ---");
const pool = readFileSync("src/meetingPool.js", "utf8");
check("heal is scheduled on a short pool", /if \(ready < POOL_SIZE\)/.test(pool), true);
check("heal retries a few times", /scheduleHeal\(attemptsLeft - 1\)/.test(pool), true);
check("heal stops once full", /if \(deficit <= 0\) return;/.test(pool), true);
check("heal timer is unref'd", /healTimer\.unref\?\.\(\)/.test(pool), true);
check("initPool returns the real count", /return ready;/.test(pool), true);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
