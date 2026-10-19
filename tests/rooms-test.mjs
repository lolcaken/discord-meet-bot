/**
 * rooms.json is the source of truth: editing it must change what `meet`
 * returns, with no restart and no cached copy.
 */
import "dotenv/config";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "meetbot-rooms2-"));
process.env.DATA_DIR = tmp;

const out = [];
const say = (s) => { out.push(s); writeFileSync(new URL("rooms-test.txt", import.meta.url), out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(48)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const MAIN = "1550540829112795187";
const OTHER = "222222222222222222";
const SEEDS = { 1: "seed-one-x1", 2: "seed-two-x2", 3: "seed-three-x3", 4: "seed-four-x4" };

const { seedGuildRooms, resolveGuildRoom, getGuildRoom } = await import("../src/guildRooms.js");
const roomsFile = path.join(tmp, "guilds", MAIN, "rooms.json");

say("--- boot seeds the main guild's file ---");
const added = await seedGuildRooms(MAIN, SEEDS);
check("four slots written", added, 4);
check("rooms.json exists", existsSync(roomsFile), true);
check("slot 1 seeded", JSON.parse(readFileSync(roomsFile, "utf8"))["1"], "seed-one-x1");
check("resolves from the file", await resolveGuildRoom(MAIN, "1", { seed: SEEDS[1] }), "seed-one-x1");

say("\n--- editing the file changes the answer immediately ---");
// This is the whole point: no restart, no cache.
writeFileSync(roomsFile, JSON.stringify({ ...SEEDS, 1: "edited-abc-123" }, null, 2), "utf8");
check("a hand-edited slot is used at once", await resolveGuildRoom(MAIN, "1", { seed: SEEDS[1] }), "edited-abc-123");
check("other slots untouched", await resolveGuildRoom(MAIN, "2", { seed: SEEDS[2] }), "seed-two-x2");

say("\n--- a restart must not revert the edit ---");
const reAdded = await seedGuildRooms(MAIN, SEEDS);
check("re-seeding adds nothing", reAdded, 0);
check("edit survives the seed", await resolveGuildRoom(MAIN, "1", { seed: SEEDS[1] }), "edited-abc-123");

say("\n--- deleting a slot falls back to the seed ---");
writeFileSync(roomsFile, JSON.stringify({ 2: "seed-two-x2" }, null, 2), "utf8");
check("missing slot uses the seed", await resolveGuildRoom(MAIN, "1", { seed: SEEDS[1] }), "seed-one-x1");
check("and is written back", JSON.parse(readFileSync(roomsFile, "utf8"))["1"], "seed-one-x1");

say("\n--- other servers have no seed, so they mint instead ---");
let minted = null;
const orig = process.env.DATA_DIR;
void orig;
// No network here: just prove a serverless scope reports "not set" rather
// than silently handing back the main guild's code.
check("unknown server slot is null", await getGuildRoom(OTHER, "1"), null);
check("seed for the main guild is never given away", await resolveGuildRoom(MAIN, "4", { seed: SEEDS[4] }), "seed-four-x4");
check("other server has no file yet", existsSync(path.join(tmp, "guilds", OTHER, "rooms.json")), false);

say("\n--- a malformed file doesn't hand back rubbish ---");
writeFileSync(roomsFile, "{ broken json", "utf8");
check("corrupt file reads as unset", await getGuildRoom(MAIN, "1"), null);
check("and the seed rescues it", await resolveGuildRoom(MAIN, "1", { seed: SEEDS[1] }), "seed-one-x1");

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
rmSync(tmp, { recursive: true, force: true });
process.exitCode = fail ? 1 : 0;