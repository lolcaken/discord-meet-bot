import { createOpenMeetSpace } from "./googleMeet.js";
import { fileIn, readJson, writeJson, listScopes } from "./dataPaths.js";
import { logRoomGenerated, logFailure } from "./logger.js";

/**
 * Standing rooms, one file per server.
 *
 * `data/guilds/<guildId>/rooms.json` is the source of truth for every server,
 * including the main one. Edit a code in that file and the next person to type
 * `meet` gets the new room - no redeploy, no restart, because lookups read the
 * file rather than a cached copy.
 *
 * The main guild's file is seeded from PRELOADED_MEETS on first boot, so the
 * starting point matches the old hardcoded values and anything you change
 * afterwards sticks. Other servers have no seed: their slots are minted from
 * the same Google account the first time they're used, which is what lets the
 * Meet API read them and the live participant count work.
 *
 * Rooms are created per slot rather than four at a time: a server that only
 * ever types `meet` costs exactly one space against Google's create quota.
 */

const inFlight = new Map(); // "guildId:slot" -> Promise, so two people racing don't mint two spaces

const file = (guildId) => fileIn({ guildId }, "rooms.json");

async function putRoom(guildId, slot, code) {
  const rooms = await readJson(file(guildId), {});
  await writeJson(file(guildId), { ...(rooms && typeof rooms === "object" ? rooms : {}), [slot]: code });
}

/**
 * Writes any missing seed slots into a server's rooms.json and leaves existing
 * ones alone, so an edit is never undone by a restart. Returns how many were
 * added, so the boot log can say whether anything changed.
 */
export async function seedGuildRooms(guildId, seeds = {}) {
  const rooms = await readJson(file(guildId), {});
  const known = rooms && typeof rooms === "object" && !Array.isArray(rooms) ? rooms : {};

  let added = 0;
  for (const [slot, code] of Object.entries(seeds)) {
    if (code && !known[slot]) {
      known[slot] = code;
      added++;
    }
  }
  if (added) await writeJson(file(guildId), known);
  return added;
}

/** The stored code for a server's slot, or null if it has never been set. */
export async function getGuildRoom(guildId, slot) {
  const rooms = await readJson(file(guildId), {});
  return rooms?.[String(slot)] ?? null;
}

/**
 * The code for a server's slot: what's in rooms.json, else the seed, else a
 * freshly minted space. Throws if Google refuses, so the caller can fall back
 * to a pooled link.
 */
export async function resolveGuildRoom(guildId, slot, { seed } = {}) {
  const key = String(slot);
  const stored = await getGuildRoom(guildId, key);
  if (stored) return stored;

  if (seed) {
    await putRoom(guildId, key, seed);
    return seed;
  }
  return getOrCreateGuildRoom(guildId, key);
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
    await putRoom(guildId, key, space.meetingCode);

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
  const scopes = await listScopes();
  let count = 0;
  for (const scope of scopes.filter((s) => s.guildId)) {
    const rooms = await readJson(file(scope.guildId), null);
    if (rooms && Object.keys(rooms).length) count++;
  }
  return count;
}
