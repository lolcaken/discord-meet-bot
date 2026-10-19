/**
 * config.json - the switches that turn features on and off.
 *
 * The loader has to be forgiving, because a config file is edited by hand by
 * whoever runs the bot: a missing file, a broken file and a typo in a value
 * all have to end with a bot that starts, not one that crashes on boot.
 */
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const out = [];
const say = (s) => { out.push(s); writeFileSync(new URL("config-test.txt", import.meta.url), out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(50)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const { loadConfig, commandEnabled, featureEnabled, limit, configPath, hasConfigFile } =
  await import("../src/config.js");

say("=== the shipped config.json ===");
check("the file exists", hasConfigFile(), true);
check("it is a real file on disk", readFileSync(configPath, "utf8").length > 0, true);
const shipped = JSON.parse(readFileSync(configPath, "utf8"));
check("it has a commands section", typeof shipped.commands, "object");
check("it has a features section", typeof shipped.features, "object");
check("it has a limits section", typeof shipped.limits, "object");
check("every command is a boolean",
  Object.values(shipped.commands).every((v) => typeof v === "boolean"), true);
check("every feature is a boolean",
  Object.values(shipped.features).every((v) => typeof v === "boolean"), true);
check("every limit is a positive number",
  Object.values(shipped.limits).every((v) => typeof v === "number" && v > 0), true);
check("it has no secrets in it",
  !/"token"|"secret"|"password"|refresh/i.test(readFileSync(configPath, "utf8")), true);

say("\n=== everything is on by default ===");
const cfg = loadConfig();
check("meet is on", commandEnabled("meet"), true);
check("last is on", commandEnabled("last"), true);
check("globallast is on", commandEnabled("globallast"), true);
check("standing rooms are on", featureEnabled("standingRooms"), true);
check("the counter is on", featureEnabled("participantCounter"), true);
check("the cooldown is the default", limit("cooldownSeconds"), 5);
check("the pool size is the default", limit("poolSize"), 5);

say("\n=== an unknown name is off, not on ===");
check("an unknown command is off", commandEnabled("notacommand"), false);
check("an unknown feature is off", featureEnabled("notafeature"), false);
check("an unknown limit falls back", limit("notalimit"), undefined);

say("\n=== the environment can still override a limit ===");
process.env.MEETING_POOL_SIZE = "9";
check("the env wins over config.json", limit("poolSize"), 9);
delete process.env.MEETING_POOL_SIZE;
check("and the config comes back when it's gone", limit("poolSize"), 5);

say("\n=== a broken config doesn't stop the bot ===");
// The loader reads the real file, so this checks the parsing rules against
// the same code path rather than a copy of it.
const broken = JSON.parse(readFileSync(configPath, "utf8"));
const original = readFileSync(configPath, "utf8");
try {
  writeFileSync(configPath, "{ this is not json");
  const reloaded = loadConfig({ reload: true });
  check("it fell back to the defaults", reloaded.commands.meet, true);
  check("and every command is still on",
    Object.values(reloaded.commands).every(Boolean), true);
} finally {
  writeFileSync(configPath, original);
  loadConfig({ reload: true });
}

say("\n=== a value of the wrong type is ignored, not obeyed ===");
try {
  const bad = JSON.parse(original);
  bad.commands.meet = "yes";        // not a boolean
  bad.limits.cooldownSeconds = -1;  // not a positive number
  bad.commands.invented = true;      // a key nobody knows about
  writeFileSync(configPath, JSON.stringify(bad, null, 2));
  const reloaded = loadConfig({ reload: true });
  check("a string didn't turn the command off", reloaded.commands.meet, true);
  check("a negative number didn't take", reloaded.limits.cooldownSeconds, 5);
  check("an unknown key was ignored", reloaded.commands.invented, undefined);
} finally {
  writeFileSync(configPath, original);
  loadConfig({ reload: true });
}

say("\n=== a command can actually be switched off ===");
try {
  const off = JSON.parse(original);
  off.commands.roster = false;
  off.commands.globallast = false;
  off.features.participantCounter = false;
  writeFileSync(configPath, JSON.stringify(off, null, 2));
  loadConfig({ reload: true });
  check("roster is off", commandEnabled("roster"), false);
  check("globallast is off", commandEnabled("globallast"), false);
  check("the counter is off", featureEnabled("participantCounter"), false);
  check("the others are unaffected", commandEnabled("meet"), true);
} finally {
  writeFileSync(configPath, original);
  loadConfig({ reload: true });
}
check("and it's back on again", commandEnabled("roster"), true);

say("\n--- the typed commands respect it too ---");
const { parseTextCommand } = await import("../src/textCommands.js");
try {
  const off = JSON.parse(original);
  off.commands.meet = false;
  writeFileSync(configPath, JSON.stringify(off, null, 2));
  loadConfig({ reload: true });
  check("typed meet doesn't parse when meet is off", parseTextCommand("meet"), null);
  check("typed cd doesn't either", parseTextCommand("cd"), null);
  check("typed meet2 doesn't either", parseTextCommand("meet2"), null);
  check("other commands still work", parseTextCommand("rand")?.name, "rand");
} finally {
  writeFileSync(configPath, original);
  loadConfig({ reload: true });
}

say("\n--- standing rooms can be switched off on their own ---");
try {
  const off = JSON.parse(original);
  off.features.standingRooms = false;
  writeFileSync(configPath, JSON.stringify(off, null, 2));
  loadConfig({ reload: true });
  check("typed meet stops parsing", parseTextCommand("meet"), null);
  check("but the slash command is still there", commandEnabled("meet"), true);
} finally {
  writeFileSync(configPath, original);
  loadConfig({ reload: true });
}

say("\n--- the slash command list follows the config ---");
const { enabledCommands, allCommands } = await import("../src/deploy-commands.js");
check("there are nine commands in total", allCommands().length, 9);
check("giverole is one of them", allCommands().includes("giverole"), true);
try {
  const off = JSON.parse(original);
  off.commands.rand = false;
  off.commands.end = false;
  writeFileSync(configPath, JSON.stringify(off, null, 2));
  loadConfig({ reload: true });
  const enabled = enabledCommands().map((c) => c.name);
  check("rand is not registered", enabled.includes("rand"), false);
  check("end is not registered", enabled.includes("end"), false);
  check("meet still is", enabled.includes("meet"), true);
  check("the total dropped by two", enabled.length, 7);
} finally {
  writeFileSync(configPath, original);
  loadConfig({ reload: true });
}
check("and they're all back", enabledCommands().length, 9);

say("\n--- giverole can be switched off ---");
try {
  const off = JSON.parse(original);
  off.commands.giverole = false;
  writeFileSync(configPath, JSON.stringify(off, null, 2));
  loadConfig({ reload: true });
  check("the command is off", commandEnabled("giverole"), false);
  check("and it isn't registered", enabledCommands().map((c) => c.name).includes("giverole"), false);
  check("typed giverole doesn't parse", parseTextCommand("giverole @someone Admin"), null);
  check("other commands are unaffected", commandEnabled("meet"), true);
} finally {
  writeFileSync(configPath, original);
  loadConfig({ reload: true });
}
check("and it's back on", commandEnabled("giverole"), true);
check("typed giverole parses again", parseTextCommand("giverole @someone Admin")?.name, "giverole");

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;