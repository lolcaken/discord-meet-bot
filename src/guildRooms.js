import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenMeetSpace } from "./googleMeet.js";
import { logRoomGenerated, logFailure } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
// Overridable so the store can be exercised without touching real data.
const FILE = process.env.GUILD_ROOMS_FILE || path.join(DATA_DIR, "guildRooms.json");

/**
 * Standing rooms for every server except the main one.
 *
 * The main guild has a fixed set of links that must never be regenerated, so it
 * is served from PRELOADED_MEETS and never touches this file. Every other
 * server gets its own rooms, minted on demand from the same Google account as
 * the rest of the bot - which means the Meet API can read them and the live
 * participant count works the same as everywhere else.
 *
 * Rooms are created per slot rather than four at a time: a server that only
 * ever types `meet` costs exactly one space against Google's create quota.
 *
 * Shape: { "<guildId>": { "<slot>": "abc-defg-hij" } }
 */

let cache = null;
const inFlight = new Map(); // "guildId:slot" -> Promise, so two people racing don't mint two spaces

async function load() {
  if (cache) return cache;
  if (!existsSync(FILE)) {
    cache = {};
    return cache;
  }
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8"));
    cache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // A half-written file must not take the bot down; start clean.
    cache = {};
  }
  return cache;
}

async function persist(rooms) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(rooms, null, 2), "utf8");
}

/** The stored code for a server's slot, or null if it has never been minted. */
export async function getGuildRoom(guildId, slot) {
  const rooms = await load();
  return rooms[guildId]?.[String(slot)] ?? null;
}

/**
 * The code for a server's slot, minting a space the first time it's needed.
 * Throws if Google refuses, so the caller can fall back to a pooled link.
 */
export async function getOrCreateGuildRoom(guildId, slot) {
  const key = String(slot);
  const existing = await getGuildRoom(guildId, key);
  if (existing) return existing;

  const dedupeKey = `${guildId}:${key}`;
  if (inFlight.has(dedupeKey)) return inFlight.get(dedupeKey);

  const task = (async () => {
    const space = await createOpenMeetSpace();
    const rooms = await load();
    rooms[guildId] = { ...(rooms[guildId] ?? {}), [key]: space.meetingCode };
    await persist(rooms);

    await logRoomGenerated({
      guildId,
      slot: key,
      meetingCode: space.meetingCode,
      meetingUri: space.meetingUri,
      summary: `Minted a standing room for server ${guildId}, slot ${key}`,
    });

    return space.meetingCode;
  })();

  inFlight.set(dedupeKey, task);
  try {
    return await task;
  } catch (err) {
    await logFailure({
      guildId,
      slot: key,
      reason: err.message,
      summary: `Couldn't mint a standing room for server ${guildId}, slot ${key}`,
    });
    throw err;
  } finally {
    inFlight.delete(dedupeKey);
  }
}

/** How many servers have rooms, for the boot log. */
export async function countServicedGuilds() {
  return Object.keys(await load()).length;
}
