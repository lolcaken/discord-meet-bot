import path from "node:path";
import { existsSync } from "node:fs";
import { fileIn, readJson, writeJson, ensureDir, scopeDir, DATA_ROOT } from "./dataPaths.js";
import { describeGuild } from "./scopeInfo.js";
import { seedGuildRooms } from "./guildRooms.js";

/**
 * What servers is this bot actually in?
 *
 * Everything else in data/ is written per server and only when a server does
 * something. That means a wiped disk leaves you with folders you can't identify
 * and no list of where the bot is at all - which is exactly what happened when
 * the previous host vanished. This module keeps one consolidated answer:
 *
 *   - `rebuild()` rebuilds data/guilds.json from the live gateway cache on
 *     every boot, so the inventory is reconstructed from Discord rather than
 *     trusted from a file that may itself have been lost.
 *   - It also re-seeds each server's rooms.json from source when the folder is
 *     gone, so the standing rooms come back the way seedGuildRooms always did.
 *   - `render()` turns the inventory into the plain text `/servers` prints.
 *
 * Guild details come from the gateway cache, so this costs no extra API calls.
 */

const INVENTORY_FILE = "guilds.json";

const roomsFile = (guildId) => fileIn({ guildId }, "rooms.json");

// The inventory is one file for the whole bot, so it sits at the data root
// rather than inside any one server's folder.
const inventoryFile = () => path.join(DATA_ROOT, INVENTORY_FILE);

/**
 * Make sure a server's data folder exists and holds at least an empty rooms.json.
 * The other per-server files are created on first write and every read falls back
 * to an empty value, so they don't need forcing into place here.
 */
export async function ensureGuildFolder(guildId, { seeds = {} } = {}) {
  // Ask the filesystem directly rather than via readJson, which swallows a
  // missing file and hands back the fallback. Note this tracks the *folder*:
  // a server with no seed legitimately has no rooms.json until someone types
  // `meet` there, so keying off that file would report every boot as a repair.
  const created = !existsSync(scopeDir({ guildId }));
  await ensureDir(scopeDir({ guildId }));
  const seeded = await seedGuildRooms(guildId, seeds);
  return { created, seeded };
}

/** One row per server the bot is in, with the standing rooms it has. */
export async function buildInventory(client, { isMainGuild = () => false, seeds = {} } = {}) {
  const rows = [];
  for (const guild of client.guilds.cache.values()) {
    const scope = { guildId: guild.id };
    const rooms = await readJson(roomsFile(guild.id), {});
    const roomCount = rooms && typeof rooms === "object" ? Object.keys(rooms).length : 0;
    rows.push({
      ...describeGuild(guild, { isMainGuild: isMainGuild(guild.id) }),
      roomCount,
      rooms: rooms && typeof rooms === "object" ? rooms : {},
    });
  }
  rows.sort((a, b) => Number(b.isMainGuild) - Number(a.isMainGuild) || a.name?.localeCompare(b.name));
  return rows;
}

/**
 * Rebuild the whole picture: ensure every folder exists, write data/guilds.json,
 * and return the rows. Safe to run on every boot - nothing here overwrites a
 * hand-edited rooms.json, it only fills in what is missing.
 */
export async function rebuild(client, { isMainGuild = () => false, seeds = {}, mainGuildId = null } = {}) {
  const ensured = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      const result = await ensureGuildFolder(guild.id, {
        seeds: guild.id === mainGuildId ? seeds : {},
      });
      if (result.created || result.seeded) ensured.push({ guildId: guild.id, ...result });
    } catch (err) {
      console.error(`Couldn't prepare data folder for server ${guild.id}:`, err.message);
    }
  }

  const rows = await buildInventory(client, { isMainGuild, seeds });
  await writeJson(inventoryFile(), {
    kind: "inventory",
    generatedAt: new Date().toISOString(),
    serverCount: rows.length,
    servers: rows,
  });
  return { rows, ensured };
}

/** The inventory as plain text for `/servers`, trimmed to Discord's 2000. */
export function render(rows) {
  if (!rows.length) return "Not in any servers yet.";

  const line = (row) => {
    const tags = [row.isMainGuild ? "main" : null, row.roomCount ? `${row.roomCount} rooms` : "no rooms"]
      .filter(Boolean)
      .join(" - ");
    return `${row.id} - ${row.memberCount ?? "?"} members - ${tags}`;
  };

  const header = `servers - ${rows.length}`;
  const blocks = rows.map((row, i) => [`${i + 1}. ${row.name ?? "(unnamed)"}`, `   ${line(row)}`]);

  // Add whole servers until the next one wouldn't fit, rather than building one
  // huge string and trimming it: that way the limit can never be an off-by-one
  // away from an endless loop, and what survives is always a valid server.
  const kept = [];
  let used = header.length;
  for (const [title, detail] of blocks) {
    const cost = 1 + title.length + detail.length;
    if (used + cost > 1950) break;
    kept.push(title, detail);
    used += cost;
  }

  const lines = [header, ...kept];
  if (kept.length < blocks.length * 2) lines.push(`   ...and ${blocks.length - kept.length / 2} more`);
  return lines.join("\n");
}