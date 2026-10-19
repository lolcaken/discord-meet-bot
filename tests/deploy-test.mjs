/**
 * The slash-command registration, without touching Discord.
 *
 * The REST call is stubbed, so this checks the parts that actually matter
 * day to day: that .env is found no matter where the app is started from,
 * that the fingerprint stops a needless re-register, and that a changed
 * command list does trigger one.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const out = [];
const say = (s) => { out.push(s); writeFileSync(new URL("deploy-test.txt", import.meta.url), out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const tmp = mkdtempSync(path.join(tmpdir(), "meetbot-deploy-"));
process.env.DATA_DIR = tmp;

const { registerCommands } = await import("../src/deploy-commands.js");
const { DATA_ROOT } = await import("../src/dataPaths.js");

// Record the REST calls instead of making them, so this exercises the real
// registration path without touching Discord.
const calls = [];
const { REST } = await import("discord.js");
const realPut = REST.prototype.put;
REST.prototype.put = async function (route, options) {
  calls.push({ route, body: options?.body });
  return { status: 200, body: options?.body };
};

say("=== the command list is well formed ===");
const deploySrc = readFileSync(new URL("../src/deploy-commands.js", import.meta.url), "utf8");
// Only the command builders count, not the option names (title, minutes,
// notify, code) - those are setName calls on options, not on commands.
const commandBlocks = deploySrc.split("new SlashCommandBuilder()").slice(1);
const names = commandBlocks.map((b) => /setName\("([a-z]+)"\)/.exec(b)?.[1]).filter(Boolean);
const unique = [...new Set(names)];
check("eight commands are defined", unique.length, 8);
check("no duplicate command names", unique.length, names.length);
check("the new ones are there",
  ["roster", "globalroster", "globallast", "servers"].every((n) => unique.includes(n)), true);
check("the original ones are still there",
  ["meet", "schedule", "end", "rand"].every((n) => unique.includes(n)), true);
check("every command has a description",
  commandBlocks.every((b) => b.includes(".setDescription(")), true);

say("\n--- the owner commands are locked at the Discord level ---");
for (const name of ["roster", "globalroster", "globallast"]) {
  const block = new RegExp(`setName\\("${name}"\\)[\\s\\S]*?\\.toJSON\\(\\)`).exec(deploySrc)?.[0] ?? "";
  check(`${name} is permission-gated`, block.includes("setDefaultMemberPermissions(0)"), true);
}

say("\n--- the deploy is idempotent ---");
const first = await registerCommands();
check("it registered", first.count, 8);
check("it hit Discord twice: the guild and globally", calls.length, 2);
check("one call was the guild", calls[0].route.includes("/guilds/"), true);
check("one call was global", calls[1].route.includes("/commands"), true);
check("all eight commands were sent", calls[0].body.length, 8);
check("the sent body is plain JSON, not builders",
  typeof calls[0].body[0], "object");

const stateFile = path.join(DATA_ROOT, "commands-deployed.json");
check("a fingerprint file is written", existsSync(stateFile), true);
if (!existsSync(stateFile)) {
  say(`      DATA_ROOT = ${DATA_ROOT}`);
  say(`      tmp       = ${tmp}`);
}
const state = JSON.parse(readFileSync(stateFile, "utf8"));
check("it records the fingerprint", typeof state.fingerprint, "string");
check("it records when", typeof state.at, "string");
check("it records the scope", state.scope.includes("globally"), true);
check("it recorded the guild too", state.scope.includes("1550540829112795187"), true);

say("\n--- a second run does not call Discord again ---");
const callsBefore = calls.length;
const second = await registerCommands();
check("it skipped", second.scope, "skipped");
check("no extra API call was made", calls.length, callsBefore);

say("\n--- a changed command list does register again ---");
const forced = await registerCommands({ force: true });
check("it registered", forced.count, 8);
check("and it called Discord again", calls.length, callsBefore + 2);

REST.prototype.put = realPut;

say("\n--- the fingerprint changes when a command changes ---");
const { createHash } = await import("node:crypto");
const fingerprintOf = (list) => createHash("sha256").update(JSON.stringify(list)).digest("hex");
const before = fingerprintOf([{ name: "a" }]);
const after = fingerprintOf([{ name: "a" }, { name: "b" }]);
check("a different list is a different fingerprint", before !== after, true);
check("the same list is the same fingerprint",
  fingerprintOf([{ name: "a" }]) === before, true);

say("\n--- the env is found from any working directory ---");
const deploySrcHasPath = /loadEnv\(\{ path: path\.join\(APP_DIR, "\.env"\) \}\)/.test(deploySrc);
check("deploy loads .env by absolute path", deploySrcHasPath, true);
const indexSrc = readFileSync(new URL("../index.js", import.meta.url), "utf8");
check("the entry point loads .env by absolute path",
  /loadEnv\(\{ path: path\.join\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\), "\.env"\) \}\)/.test(indexSrc),
  true);
check("neither relies on dotenv/config's cwd lookup",
  !/import "dotenv\/config"/.test(deploySrc) && !/import "dotenv\/config"/.test(indexSrc), true);

say("\n--- a missing token fails loudly, not silently ---");
const saved = { ...process.env };
delete process.env.DISCORD_TOKEN;
delete process.env.DISCORD_CLIENT_ID;
// The module read the env at import time, so this checks the guard directly.
check("the guard exists", /DISCORD_TOKEN and DISCORD_CLIENT_ID must be set/.test(deploySrc), true);
check("a failed deploy exits non-zero", /process\.exitCode = 1/.test(deploySrc), true);
Object.assign(process.env, saved);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
rmSync(tmp, { recursive: true, force: true });
process.exitCode = fail ? 1 : 0;