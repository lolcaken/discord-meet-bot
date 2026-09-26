import { createOpenMeetSpace } from "./googleMeet.js";

const POOL_SIZE = Number(process.env.MEETING_POOL_SIZE) || 5;

const pool = [];
let inFlightRefills = 0;

async function createAndPush() {
  try {
    const space = await createOpenMeetSpace();
    pool.push(space);
  } catch (err) {
    console.error("Failed to pre-create a pooled meeting (will retry on next top-up):", err);
  } finally {
    inFlightRefills--;
  }
}

/** Fire-and-forget: tops the pool back up toward POOL_SIZE without blocking the caller. */
function topUp() {
  const deficit = POOL_SIZE - pool.length - inFlightRefills;
  for (let i = 0; i < deficit; i++) {
    inFlightRefills++;
    createAndPush();
  }
}

/**
 * Fills the pool before the bot starts accepting commands, so even the
 * very first /meet after startup is instant instead of paying the
 * Meet-API round trip.
 */
export async function initPool() {
  const needed = POOL_SIZE - pool.length;
  if (needed <= 0) return;
  inFlightRefills += needed;
  await Promise.all(Array.from({ length: needed }, () => createAndPush()));
  console.log(`✅ Meeting pool ready (${pool.length}/${POOL_SIZE} pre-created)`);
}

/**
 * Instantly hands back a pre-created meeting space and kicks off a
 * replacement in the background. Falls back to creating one on the spot
 * if the pool is empty (e.g. a burst of requests drained it) — this path
 * is never slower than not having a pool at all, just not faster.
 */
export async function takeMeeting() {
  const space = pool.shift();
  topUp();
  if (space) return space;
  return createOpenMeetSpace();
}

/** Current pool depth — handy for a status command or logs. */
export function poolSize() {
  return pool.length;
}
