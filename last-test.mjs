import { parseTextCommand } from "./src/textCommands.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const out = [];
const say = (s) => { out.push(s); writeFileSync("last-test.txt", out.join("\n") + "\n", "utf8"); };

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

say("\n--- candidate ordering: this channel first, then the server ---");
const tmp = mkdtempSync(path.join(tmpdir(), "meetbot-last-"));
process.env.DATA_DIR = tmp;
const { recentSpaces } = await import("./src/spaceRegistry.js");

const G = "111111111111111111";
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

const picks = await recentSpaces({ guildId: G }, "chan-A", 5);
check("channel A entries come first", picks.map((p) => p.code), ["older-here", "oldest-here", "newest-other"]);
check("limit is honoured", (await recentSpaces({ guildId: G }, "chan-A", 2)).length, 2);
check("no channel still lists newest first",
  (await recentSpaces({ guildId: G }, null, 5)).map((p) => p.code), ["newest-other", "older-here", "oldest-here"]);
check("unknown scope is empty", await recentSpaces({ guildId: "222222222222222222" }, "chan-A"), []);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
rmSync(tmp, { recursive: true, force: true });
process.exitCode = fail ? 1 : 0;
