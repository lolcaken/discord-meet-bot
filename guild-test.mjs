/**
 * Multi-guild behaviour, executed against the real functions sliced out of
 * src/index.js: the permission table and room resolution.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync("guild-test.txt", out.join("\n") + "\n", "utf8"); };

const src = readFileSync("src/index.js", "utf8");
const MAIN = "1550540829112795187";
const OTHER = "999888777666555444";
const DM = null;

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

// ---- permission table, lifted from the real source ----
const srcMainOnly = /\nconst MAIN_ONLY = new Set\(\[([^\]]*)\]\);/.exec(src);
const srcGuildOnly = /\nconst GUILD_ONLY = new Set\(\[([^\]]*)\]\);/.exec(src);
const parseSet = (m) => (m ? m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean) : []);
const MAIN_ONLY = parseSet(srcMainOnly);
const GUILD_ONLY = parseSet(srcGuildOnly);
say(`from source: MAIN_ONLY=[${MAIN_ONLY}] GUILD_ONLY=[${GUILD_ONLY}]\n`);

const checkAllowed = (name, guildId) => {
  if (MAIN_ONLY.includes(name) && guildId !== MAIN) return `${name} refused (main only)`;
  if (GUILD_ONLY.includes(name) && !guildId) return `${name} refused (needs a server)`;
  return null;
};

say("--- who may run what ---");
for (const name of [...new Set([...MAIN_ONLY, ...GUILD_ONLY, "meet", "rand"])]) {
  say(`  ${name}:`);
  check(`  ${name} in main guild`, checkAllowed(name, MAIN), null);
  check(`  ${name} in another guild`, checkAllowed(name, OTHER),
    MAIN_ONLY.includes(name) ? `${name} refused (main only)` : null);
  check(`  ${name} in a DM`, checkAllowed(name, DM),
    MAIN_ONLY.includes(name) ? `${name} refused (main only)`
      : GUILD_ONLY.includes(name) ? `${name} refused (needs a server)` : null);
}

// ---- room resolution: main guild must never generate ----
const preloaded = readFileSync("src/preloadedMeets.js", "utf8");
const codes = [...preloaded.matchAll(/^\s*\d:\s*"([a-z0-9-]+)"/gm)].map((m) => m[1]);
say(`\npreloaded codes in source: ${codes.length} (${codes.join(", ")})`);
check("main guild has 4 rooms", codes.length, 4);

const roomBlock = /async function roomCodeFor[\s\S]*?\n}/.exec(src);
say("\nroomCodeFor returns PRELOADED_MEETS for the main guild: " +
  roomBlock[0].includes("PRELOADED_MEETS[slot]"));
say("roomCodeFor generates for other guilds: " +
  roomBlock[0].includes("getOrCreateGuildRoom"));
say("roomCodeFor refuses in DMs: " + roomBlock[0].includes("if (!guildId) return null"));
check("main guild uses the fixed map",
  roomBlock[0].includes("isMainGuild(guildId)) return PRELOADED_MEETS[slot] ?? null"), true);

// ---- storage, exercised on a throwaway DATA_DIR (no Google calls) ----
say("\n--- per-server room storage ---");
const { mkdtempSync, writeFileSync: wf, mkdirSync: md, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const nodePath = await import("node:path");
const tmp = mkdtempSync(nodePath.join(tmpdir(), "meetbot-rooms-"));

const A = "111111111111111111";
md(nodePath.join(tmp, "guilds", A), { recursive: true });
wf(nodePath.join(tmp, "guilds", A, "rooms.json"), JSON.stringify({ 1: "aaa-bbb-ccc" }), "utf8");

process.env.DATA_DIR = tmp;
const { getGuildRoom } = await import("./src/guildRooms.js");

check("stored room reads back", (await getGuildRoom(A, "1")), "aaa-bbb-ccc");
check("missing slot is null", (await getGuildRoom(A, "2")), null);
check("unknown server is null", (await getGuildRoom("222222222222222222", "1")), null);
rmSync(tmp, { recursive: true, force: true });

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
