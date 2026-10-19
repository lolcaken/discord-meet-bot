import { parseTextCommand } from "../src/textCommands.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const out = [];
const say = (s) => { out.push(s); writeFileSync(new URL("last-test.txt", import.meta.url), out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(44)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const cmd = (n) => ({ name: n, options: { name: n } });

say("--- `last` is recognised ---");
check("bare last", parseTextCommand("last"), cmd("last"));
check("LAST uppercase", parseTextCommand("LAST"), cmd("last"));
check("!last", parseTextCommand("!last"), cmd("last"));
check("padded last", parseTextCommand("  last  "), cmd("last"));

say("\n--- but not inside a sentence ---");
for (const t of ["last night's plans", "that was the last one", "see you last", "lastly", "blast"]) {
  check(JSON.stringify(t), parseTextCommand(t), null);
}
check("no trailing args allowed", parseTextCommand("last abc-defg-hij"), null);

say("\n--- existing commands still parse ---");
check("meet", parseTextCommand("meet"), cmd("meet"));
check("cd", parseTextCommand("cd"), cmd("meet"));
check("rand", parseTextCommand("rand"), cmd("rand"));
check("meet2", parseTextCommand("meet2"), cmd("meet2"));
check("/last is not a typed command", parseTextCommand("/last"), null);

say("\n--- every meeting in the server is a candidate ---");
const tmp = mkdtempSync(path.join(tmpdir(), "meetbot-last-"));
process.env.DATA_DIR = tmp;
const { allSpaces, spacesForEveryGuild } = await import("../src/spaceRegistry.js");

const G = "111111111111111111";
const G2 = "222222222222222222";
const chan = (n, code, channelId) => ({ name: `spaces/${code}`, code, uri: `https://meet.google.com/${code}`, channelId });

// spaces.json is stored newest-first.
mkdirSync(path.join(tmp, "guilds", G), { recursive: true });
writeFileSync(
  path.join(tmp, "guilds", G, "spaces.json"),
  JSON.stringify([
    chan(1, "newest-other", "chan-B"),
    chan(2, "older-here", "chan-A"),
    chan(3, "oldest-here", "chan-A"),
  ]),
  "utf8"
);

const all = await allSpaces({ guildId: G });
check("every space is returned", all.length, 3);
check("newest first, no channel preference",
  all.map((p) => p.code), ["newest-other", "older-here", "oldest-here"]);
check("unknown scope is empty", await allSpaces({ guildId: G2 }), []);
check("a second guild's spaces are separate", await allSpaces({ guildId: G2 }), []);

say("\n--- a second server with meetings is found too ---");
mkdirSync(path.join(tmp, "guilds", G2), { recursive: true });
writeFileSync(
  path.join(tmp, "guilds", G2, "spaces.json"),
  JSON.stringify([chan(1, "other-guild-one", "chan-Z")]),
  "utf8"
);

const every = await spacesForEveryGuild();
check("both servers are listed", every.length, 2);
check("the first server's spaces are there",
  every.find((s) => s.guildId === G).entries.length, 3);
check("the second server's spaces are there",
  every.find((s) => s.guildId === G2).entries.length, 1);

say("\n--- a guild with no meetings is not listed ---");
mkdirSync(path.join(tmp, "guilds", "333333333333333333"), { recursive: true });
const after = await spacesForEveryGuild();
check("an empty server is skipped", after.length, 2);

say("\n--- DM scopes are not servers ---");
mkdirSync(path.join(tmp, "dms", "444444444444444444"), { recursive: true });
writeFileSync(
  path.join(tmp, "dms", "444444444444444444", "spaces.json"),
  JSON.stringify([chan(1, "dm-one", "dm")]),
  "utf8"
);
const withDm = await spacesForEveryGuild();
check("a DM scope is not counted as a server", withDm.length, 2);
check("the DM's meeting is not in the server list",
  withDm.some((s) => s.entries.some((e) => e.code === "dm-one")), false);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
rmSync(tmp, { recursive: true, force: true });
process.exitCode = fail ? 1 : 0;
