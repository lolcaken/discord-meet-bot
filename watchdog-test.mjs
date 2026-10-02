/**
 * Why the bot died with exit code 0, and that the watchdog prevents it.
 *
 * Reproduces the shape: every long-lived timer registered inside the gateway's
 * ready handler, the gateway never connecting, and nothing else holding the
 * event loop open. Node then exits cleanly with 0, which a host reads as a
 * deliberate shutdown and refuses to restart.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync("watchdog-test.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(48)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: "still-running", err });
    }, 4000);
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, err });
    });
  });

const { writeFileSync: wf, mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const path = await import("node:path");
const dir = mkdtempSync(path.join(tmpdir(), "watchdog-"));

say("--- without a keep-alive: exits 0, which is the bug ---");
const bare = path.join(dir, "bare.mjs");
wf(bare, `
// Everything scheduled inside a handler that never fires, like timers
// registered in a gateway ready event that never arrives.
const onReady = async () => { setInterval(() => {}, 60000); };
void onReady; // never called - the gateway never connects
`, "utf8");
const bareRun = await run(bare);
check("process exits on its own", bareRun.code, 0);

say("\n--- with the watchdog: stays alive instead ---");
const guarded = path.join(dir, "guarded.mjs");
wf(guarded, `
let connected = false;
const watchdog = setInterval(() => { if (!connected) console.warn('still waiting'); }, 60000);
void watchdog;
const onReady = async () => { connected = true; clearInterval(watchdog); setInterval(() => {}, 60000); };
void onReady;
`, "utf8");
const guardedRun = await run(guarded);
check("process is still running after 4s", guardedRun.code, "still-running");

say("\n--- the real file is wired this way ---");
const idx = (await import("node:fs")).readFileSync("src/index.js", "utf8");
const readyAt = idx.indexOf('client.once("ready"');
const watchdogAt = idx.indexOf("const watchdog = setInterval");
const clearedAt = idx.indexOf("clearInterval(watchdog)");
check("watchdog created before ready", watchdogAt !== -1 && watchdogAt < readyAt, true);
check("cleared once ready", clearedAt !== -1 && clearedAt > readyAt, true);
check("warns while disconnected", /Still not connected to Discord/.test(idx), true);
check("names the likely cause", /reach discord\.com on port 443/.test(idx), true);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
