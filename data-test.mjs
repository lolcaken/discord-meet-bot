/**
 * The per-server data layout: scoping, isolation between servers, traversal
 * safety, and the legacy migration. Runs against a throwaway DATA_DIR.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(tmpdir(), "meetbot-data-"));
process.env.DATA_DIR = root;

const out = [];
const say = (s) => { out.push(s); writeFileSync("data-test.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(50)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

// Imported after DATA_DIR is set, since the path module reads it at load.
const paths = await import("./src/dataPaths.js");
const { rememberSpace, latestSpace } = await import("./src/spaceRegistry.js");
const { addSchedule, loadAllSchedules, removeSchedule } = await import("./src/scheduleStore.js");

const A = "111111111111111111";
const B = "222222222222222222";
const U = "333333333333333333";

say(`DATA_DIR = ${root}\n`);

say("--- layout ---");
await rememberSpace({ guildId: A }, { name: "spaces/one", code: "aaa-bbb-ccc", channelId: "c1" });
check("guild folder exists", existsSync(path.join(root, "guilds", A)), true);
check("spaces.json inside it", existsSync(path.join(root, "guilds", A, "spaces.json")), true);
await rememberSpace({ userId: U }, { name: "spaces/dm", code: "ddd-eee-fff", channelId: "c9" });
check("dm folder is separate", existsSync(path.join(root, "dms", U)), true);

say("\n--- servers cannot see each other's meetings ---");
await rememberSpace({ guildId: B }, { name: "spaces/two", code: "ggg-hhh-iii", channelId: "c1" });
check("server A latest is its own", (await latestSpace({ guildId: A })).code, "aaa-bbb-ccc");
check("server B latest is its own", (await latestSpace({ guildId: B })).code, "ggg-hhh-iii");
check("DM latest is its own", (await latestSpace({ userId: U })).code, "ddd-eee-fff");
// Same channel id in both servers must not cross over.
check("same channel name doesn't leak", (await latestSpace({ guildId: A }, "c1")).code, "aaa-bbb-ccc");
check("B cannot see A's space", (await latestSpace({ guildId: B }, "nope")).code, "ggg-hhh-iii");

say("\n--- unknown scope is empty, not another server's data ---");
check("untouched guild has nothing", await latestSpace({ guildId: "444444444444444444" }), null);

say("\n--- traversal is refused ---");
const HOSTILE = ["../../etc", "..\\..\\etc", "abc", "", null, "1; rm -rf /", "12/34", "..", "0", "1e5"];
let refused = 0;
for (const bad of HOSTILE) {
  try { paths.scopeDir({ guildId: bad }); } catch { refused++; }
}
check(`all ${HOSTILE.length} hostile ids refused`, refused, HOSTILE.length);
check("valid snowflake accepted", typeof paths.scopeDir({ guildId: A }), "string");
check("18-digit id accepted", typeof paths.scopeDir({ guildId: "1550540829112795187" }), "string");

say("\n--- corrupt files degrade to empty ---");
writeFileSync(path.join(root, "guilds", A, "spaces.json"), "{ not json", "utf8");
check("corrupt read returns null", await latestSpace({ guildId: A }), null);
await rememberSpace({ guildId: A }, { name: "spaces/fixed", code: "zzz-yyy-xxx" });
check("writes recover it", (await latestSpace({ guildId: A })).code, "zzz-yyy-xxx");

say("\n--- schedules are per scope and swept together ---");
await addSchedule({ guildId: A }, { runAt: "2030-01-01T00:00:00Z", channelId: "c1", title: "A one" });
await addSchedule({ guildId: B }, { runAt: "2030-01-01T00:00:00Z", channelId: "c2", title: "B one" });
await addSchedule({ userId: U }, { runAt: "2030-01-01T00:00:00Z", channelId: "c9", title: "DM one" });
const all = await loadAllSchedules();
check("all three scopes swept", all.length, 3);
check("each carries its scope", all.filter((s) => s.__scope).length, 3);
const aEntry = all.find((s) => s.title === "A one");
check("A's schedule scoped to A", aEntry.__scope.guildId, A);
await removeSchedule(aEntry.__scope, aEntry.id);
check("removal is scoped", (await loadAllSchedules()).length, 2);

say("\n--- legacy migration ---");
const legacy = mkdtempSync(path.join(tmpdir(), "meetbot-legacy-"));
process.env.DATA_DIR = legacy;
writeFileSync(path.join(legacy, "spaces.json"), JSON.stringify([
  { name: "spaces/old1", code: "old-one-x1" },
  { name: "spaces/old2", code: "old-two-x2" },
]), "utf8");
writeFileSync(path.join(legacy, "schedules.json"), JSON.stringify([
  { id: "s1", runAt: "2030-01-01T00:00:00Z", channelId: "c1", guildId: A, title: "legacy" },
]), "utf8");
writeFileSync(path.join(legacy, "guildRooms.json"), JSON.stringify({ [B]: { 1: "bbb-ccc-ddd" } }), "utf8");

const legacyPaths = await import(`./src/dataPaths.js?v=${Date.now()}`);
const moved = await legacyPaths.migrateLegacyData({ mainGuildId: A });
say(`  moved: ${moved.length} group(s)`);
check("legacy spaces -> main guild folder", existsSync(path.join(legacy, "guilds", A, "spaces.json")), true);
check("legacy spaces kept", JSON.parse(readFileSync(path.join(legacy, "guilds", A, "spaces.json"), "utf8")).length, 2);
check("legacy schedule -> its own guild", existsSync(path.join(legacy, "guilds", A, "schedules.json")), true);
check("legacy rooms -> that guild", existsSync(path.join(legacy, "guilds", B, "rooms.json")), true);
check("old files renamed aside", existsSync(path.join(legacy, "spaces.json.migrated")), true);

const again = await legacyPaths.migrateLegacyData({ mainGuildId: A });
check("migration is idempotent", again.length, 0);
check("no duplicate spaces after re-run",
  JSON.parse(readFileSync(path.join(legacy, "guilds", A, "spaces.json"), "utf8")).length, 2);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
rmSync(root, { recursive: true, force: true });
rmSync(legacy, { recursive: true, force: true });
process.exitCode = fail ? 1 : 0;
