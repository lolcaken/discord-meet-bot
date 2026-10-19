/**
 * The inventory is what answers "which servers is the bot in" after a wipe, so
 * it is tested against a fake client and a real data directory: folders are
 * created, the main guild's rooms are restored from source, and hand-edited
 * rooms are never clobbered.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFileSync } from "node:fs";

const tmp = mkdtempSync(path.join(tmpdir(), "meetbot-inv-"));
process.env.DATA_DIR = tmp;

// googleMeet.js refuses to load without credentials, and inventory.js pulls it
// in through guildRooms.js. Nothing here calls Google, so dummies are enough
// and the test stays runnable with no .env at all.
process.env.GOOGLE_CLIENT_ID ??= "test-client";
process.env.GOOGLE_CLIENT_SECRET ??= "test-secret";
process.env.GOOGLE_REFRESH_TOKEN ??= "test-refresh";

const out = [];
const say = (s) => { out.push(s); writeFileSync(new URL("inventory-test.txt", import.meta.url), out.join("\n") + "\n", "utf8"); };

let fail = 0;
// Same signature as the other suites: check(label, got, want), so a test that
// expects false or 0 is compared rather than treated as "truthy or not".
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(48)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const { rebuild, render, ensureGuildFolder } = await import("../src/inventory.js");

const MAIN = "1550540829112795187";
const OTHER = "1463484922604945421";
const SEEDS = { 1: "ggv-nove-xkr", 2: "dbp-ttaz-vuc", 3: "wqw-ajqo-cnt", 4: "fxf-ixhq-ucm" };

const guild = (id, name, extra = {}) => ({
  id,
  name,
  ownerId: "1",
  memberCount: 100,
  // describeGuild looks up the owner in the member cache for a username.
  members: { cache: new Map([["1", { user: { username: "owner_name" } }]]) },
  channels: { cache: new Map([["a", 1]]) },
  roles: { cache: new Map() },
  ...extra,
});

const client = {
  guilds: { cache: new Map([[MAIN, guild(MAIN, "Main")], [OTHER, guild(OTHER, "Other")]]) },
};

const opts = { isMainGuild: (id) => id === MAIN, seeds: SEEDS, mainGuildId: MAIN };

say("=== boot on a completely empty data dir ===");
const first = await rebuild(client, opts);

check("both servers discovered", first.rows.length, 2);
check("main guild first", first.rows[0].id, MAIN);
check("main guild flagged", first.rows[0].isMainGuild, true);
check("other guild flagged", first.rows[1].isMainGuild, false);

const roomsPath = path.join(tmp, "guilds", MAIN, "rooms.json");
check("main guild folder was created", existsSync(path.join(tmp, "guilds", MAIN)), true);
check("rooms.json was written", existsSync(roomsPath), true);

const restored = JSON.parse(readFileSync(roomsPath, "utf8"));
check("all four standing rooms restored from source", Object.keys(restored).length, 4);
check("slot 1 is the seeded code", restored["1"], "ggv-nove-xkr");
check("slot 4 is the seeded code", restored["4"], "fxf-ixhq-ucm");

const invPath = path.join(tmp, "guilds.json");
check("inventory file written to data root", existsSync(invPath), true);
const inv = JSON.parse(readFileSync(invPath, "utf8"));
check("inventory records the server count", inv.serverCount, 2);
check("inventory has an id per server", inv.servers.map((s) => s.id), [MAIN, OTHER]);

say("\n=== a boot after that: nothing is re-seeded ===");
const second = await rebuild(client, opts);
check("no folders needed rebuilding", second.ensured.length, 0);
check("rooms unchanged", JSON.parse(readFileSync(roomsPath, "utf8")), restored);

say("\n=== a hand-edited room survives a restart ===");
const edited = { ...restored, "1": "my-own-code" };
writeFileSync(roomsPath, JSON.stringify(edited), "utf8");
await rebuild(client, opts);
check("the edit was not overwritten", JSON.parse(readFileSync(roomsPath, "utf8"))["1"], "my-own-code");
check("other slots kept", Object.keys(JSON.parse(readFileSync(roomsPath, "utf8"))).length, 4);

say("\n=== a new server joins ===");
client.guilds.cache.set("1400005266585555066", guild("1400005266585555066", "New One", { memberCount: 7 }));
const third = await rebuild(client, opts);
check("inventory now has three", third.rows.length, 3);
check("new server got a folder", existsSync(path.join(tmp, "guilds", "1400005266585555066")), true);
check("new server has no rooms until used", third.rows.find((r) => r.id === "1400005266585555066").roomCount, 0);
// A server with no seed gets no rooms.json until someone types `meet` there.
// Minting one on join would spend Google's create quota for nothing.
check("non-main server is never seeded",
  existsSync(path.join(tmp, "guilds", "1400005266585555066", "rooms.json")), false);

say("\n=== a server leaves ===");
client.guilds.cache.delete(OTHER);
const fourth = await rebuild(client, opts);
check("inventory drops it", fourth.rows.length, 2);
check("but its folder is kept on disk", existsSync(path.join(tmp, "guilds", OTHER)), true);

say("\n=== rendering ===");
const text = render(fourth.rows);
say("\n" + text.split("\n").map((l) => "  | " + l).join("\n") + "\n");
check("counts the servers", text.startsWith("servers - 2"), true);
check("names each one", text.includes("Main") && text.includes("New One"), true);
check("shows the id", text.includes(MAIN), true);
check("shows member count", text.includes("7 members"), true);
check("marks the main one", text.includes("main"), true);
check("fits inside Discord's 2000", text.length < 2000, true);
check("empty inventory has a message", render([]), "Not in any servers yet.");

say("\n=== a huge inventory still fits ===");
const many = Array.from({ length: 400 }, (_, i) => ({
  id: `1${String(i).padStart(18, "0")}`,
  name: `Server number ${i}`,
  memberCount: 1000 + i,
  isMainGuild: false,
  roomCount: 4,
}));
const huge = render(many);
check("truncated to fit", huge.length <= 2000, true);
check("says it was cut off", huge.includes("..."), true);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
rmSync(tmp, { recursive: true, force: true });
process.exitCode = fail ? 1 : 0;