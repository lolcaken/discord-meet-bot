import { createOpenMeetSpace } from "./googleMeet.js";
import { fileIn, readJson, writeJson, listScopes } from "./dataPaths.js";
import { logRoomGenerated, logFailure } from "./logger.js";

/**
 * Standing rooms for every server except the main one.
 *
 * The main guild has a fixed set of links that must never be regenerated, so it
 * is served from PRELOADED_MEETS and never touches the disk. Every other server
 * gets its own rooms in data/guilds/<guildId>/rooms.json, minted from the same
 * Google account the first time that slot is used - which is what lets the Meet
 * API read them and the live participant count work there too.
 *
 * Rooms are created per slot rather than four at a time: a server that only ever
 * types `meet` costs exactly one space against Google's create quota.
 */

const inFlight = new Map(); // "guildId:slot" -> Promise, so two people racing don't mint two spaces

const file = (guildId) => fileIn({ guildId }, "rooms.json");

/** The stored code for a server's slot, or null if it has never been minted. */
export async function getGuildRoom(guildId, slot) {
  const rooms = await readJson(file(guildId), {});
  return rooms?.[String(slot)] ?? null;
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
    const rooms = await readJson(file(guildId), {});
    await writeJson(file(guildId), { ...rooms, [key]: space.meetingCode });

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
