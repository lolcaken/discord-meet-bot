import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where everything the bot remembers lives, on disk:
 *
 *   data/guilds/<guildId>/rooms.json       standing rooms for that server
 *   data/guilds/<guildId>/spaces.json      meetings it handed out there
 *   data/guilds/<guildId>/schedules.json   pending /schedule entries
 *   data/dms/<userId>/spaces.json          same, for a DM user
 *
 * One folder per server keeps two things from bleeding together: a meeting
 * created in one server can no longer be the "latest meeting" that /end
 * targets in another, and a corrupt or hand-edited file is scoped to the one
 * place that owns it.
 *
 * The folder name comes from a Discord snowflake, which is numeric. Anything
 * else is rejected, so a crafted id can't walk out of the data directory.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const GUILDS_DIR = path.join(DATA_DIR, "guilds");
const DMS_DIR = path.join(DATA_DIR, "dms");

// Discord snowflakes are 17-20 digits. Anything outside that is not a real id:
// it can't be a folder we meant to write, and refusing it keeps a crafted value
// from ever reaching the filesystem.
const isSnowflake = (value) => typeof value === "string" && /^\d{17,20}$/.test(value);

/**
 * Resolves a scope to its folder. A scope is `{ guildId }` for a server or
 * `{ userId }` for a DM; guild wins when both are present.
 */
export function scopeDir(scope) {
  const guildId = String(scope?.guildId ?? "");
  const userId = String(scope?.userId ?? "");
  const id = isSnowflake(guildId) ? guildId : isSnowflake(userId) ? userId : null;
  if (!id) throw new Error(`Invalid data scope: ${JSON.stringify(scope)}`);
  return path.join(isSnowflake(guildId) ? GUILDS_DIR : DMS_DIR, id);
}

export function fileIn(scope, name) {
  return path.join(scopeDir(scope), name);
}

export async function ensureDir(dir) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

/** Read JSON that may not exist, or may be half-written. Never throws. */
export async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Write via a temp file then rename, so a crash mid-write can't truncate. */
export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}

/** Every scope that has a folder on disk, guilds first then DMs. */
export async function listScopes() {
  const scopes = [];
  for (const [root, key] of [[GUILDS_DIR, "guildId"], [DMS_DIR, "userId"]]) {
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && isSnowflake(entry.name)) {
        scopes.push({ [key]: entry.name, dir: path.join(root, entry.name) });
      }
    }
  }
  return scopes;
}

export const DATA_ROOT = DATA_DIR;
export const guildsRoot = () => GUILDS_DIR;
export const dmsRoot = () => DMS_DIR;

/**
 * One-time move from the old flat files. Anything already in the new layout is
 * left alone, so this is safe to run on every boot.
 *
 * Legacy spaces carry no guild id - the old schema never recorded one - so
 * they are filed under the main guild rather than guessed at. They only exist
 * to give /end a "latest meeting" to work with, and a stale one just makes it
 * say there's nothing to end.
 */
export async function migrateLegacyData({ mainGuildId } = {}) {
  const moved = [];

  const legacySpaces = path.join(DATA_DIR, "spaces.json");
  if (existsSync(legacySpaces) && mainGuildId) {
    const entries = await readJson(legacySpaces, []);
    if (Array.isArray(entries) && entries.length) {
      const target = fileIn({ guildId: mainGuildId }, "spaces.json");
      const existing = await readJson(target, []);
      const merged = [...entries, ...(Array.isArray(existing) ? existing : [])]
        .filter((e, i, all) => all.findIndex((o) => o?.name === e?.name) === i);
      await writeJson(target, merged);
      moved.push(`${entries.length} space(s) -> guilds/${mainGuildId}/spaces.json`);
    }
    await rename(legacySpaces, `${legacySpaces}.migrated`).catch(() => {});
  }

  const legacySchedules = path.join(DATA_DIR, "schedules.json");
  if (existsSync(legacySchedules) && mainGuildId) {
    const entries = await readJson(legacySchedules, []);
    if (Array.isArray(entries) && entries.length) {
      // Each entry remembers its own guild, so these can be filed correctly.
      for (const entry of entries) {
        const scope = entry.guildId ? { guildId: entry.guildId } : { userId: entry.requestedById };
        const target = fileIn(scope, "schedules.json");
        const existing = await readJson(target, []);
        await writeJson(target, [...(Array.isArray(existing) ? existing : []), entry]);
      }
      moved.push(`${entries.length} schedule(s) -> per-guild files`);
    }
    await rename(legacySchedules, `${legacySchedules}.migrated`).catch(() => {});
  }

  const legacyRooms = path.join(DATA_DIR, "guildRooms.json");
  if (existsSync(legacyRooms)) {
    const rooms = await readJson(legacyRooms, {});
    if (rooms && typeof rooms === "object") {
      for (const [guildId, slots] of Object.entries(rooms)) {
        if (!isSnowflake(guildId) || !slots || typeof slots !== "object") continue;
        await writeJson(fileIn({ guildId }, "rooms.json"), slots);
      }
      moved.push(`${Object.keys(rooms).length} guild room map(s) -> per-guild files`);
    }
    await rename(legacyRooms, `${legacyRooms}.migrated`).catch(() => {});
  }

  return moved;
}
