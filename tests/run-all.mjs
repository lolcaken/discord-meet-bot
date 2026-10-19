/**
 * Runs every suite in this folder and reports the result.
 *
 * The suites are independent files rather than one big one, so a failure
 * points at the thing that broke. This just runs them all and collects the
 * verdicts, so `npm test` is one command instead of a list to remember.
 */
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The suites live in tests/ but the app lives in the repo root, and a few of
// them touch paths that are relative to the working directory (logs/, data/).
// Running them from the root keeps that behaviour the same as running them by
// hand, which is how they were written.
const ROOT = path.dirname(HERE);

// The two suites that talk to Google's live API. They need a working refresh
// token, so they're skipped unless one is set up and the network is up.
const NEEDS_NETWORK = new Set(["auth-test.mjs", "endtest.mjs"]);

const suites = readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && f !== "run-all.mjs")
  .sort();

const hasToken = Boolean(process.env.GOOGLE_REFRESH_TOKEN);

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, file)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => resolve({ code, output }));
  });

const results = [];
for (const file of suites) {
  if (NEEDS_NETWORK.has(file) && !hasToken) {
    results.push({ file, code: null, skipped: true });
    console.log(`  SKIP  ${file} (needs a Google refresh token)`);
    continue;
  }
  const { code, output } = await run(file);
  results.push({ file, code, output });
  console.log(`  ${code === 0 ? "PASS " : "FAIL "}  ${file}`);
}

const failed = results.filter((r) => r.code !== 0 && !r.skipped);
const skipped = results.filter((r) => r.skipped);

console.log("");
if (failed.length) {
  console.log(`${failed.length} suite(s) failed:\n`);
  for (const r of failed) {
    console.log(`--- ${r.file} ---`);
    console.log(r.output.split("\n").slice(-25).join("\n"));
    console.log("");
  }
}

console.log(
  `${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`
);

process.exitCode = failed.length ? 1 : 0;
