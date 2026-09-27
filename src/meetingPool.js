import { createOpenMeetSpace } from "./googleMeet.js";
import { logFailure } from "./logger.js";

const POOL_SIZE = Number(process.env.MEETING_POOL_SIZE) || 5;

// If a create fails at boot, don't leave the pool short until somebody happens
// to use /meet. Retry the shortfall on a timer for a while, then give up and let
// the normal top-up path handle it.
const HEAL_ATTEMPTS = 4;
const HEAL_DELAY_MS = 30_000;

const pool = [];
let inFlightRefills = 0;
let healTimer = null;

const summarise = (err) => ({
  code: err?.code ?? err?.cause?.code ?? null,
  message: String(err?.message ?? err).slice(0, 300),
});

async function createAndPush() {
  try {
    const space = await createOpenMeetSpace();
    pool.push(space);
    return true;
  } catch (err) {
    console.error(
      `Failed to pre-create a pooled meeting (${err?.code ?? "error"}):`,
      err?.message ?? err
    );
    await logFailure({ area: "meetingPool", ...summarise(err) });
    return false;
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
 * Retries a shortfall a few times after boot. A single connect timeout to
 * Google shouldn't leave the pool permanently one link short, because the only
 * other thing that refills it is someone actually asking for a meeting.
 */
function scheduleHeal(attemptsLeft) {
  if (healTimer || attemptsLeft <= 0) return;
  healTimer = setTimeout(async () => {
    healTimer = null;
    const deficit = POOL_SIZE - pool.length;
    if (deficit <= 0) return;

    console.log(`Healing meeting pool: ${deficit} short, attempt ${HEAL_ATTEMPTS - attemptsLeft + 1}/${HEAL_ATTEMPTS}`);
    inFlightRefills += deficit;
    const results = await Promise.all(
      Array.from({ length: deficit }, () => createAndPush())
    );
    if (results.some(Boolean)) {
      console.log(`✅ Meeting pool healed (${pool.length}/${POOL_SIZE})`);
      return;
    }
    scheduleHeal(attemptsLeft - 1);
  }, HEAL_DELAY_MS);
  // Don't hold the process open just to heal a pool.
  healTimer.unref?.();
}

/**
 * Fills the pool before the bot starts accepting commands, so even the
 * very first /meet after startup is instant instead of paying the
 * Meet-API round trip.
 */
export async function initPool() {
  const needed = POOL_SIZE - pool.length;
  if (needed <= 0) return pool.length;
  inFlightRefills += needed;
  await Promise.all(Array.from({ length: needed }, () => createAndPush()));

  const ready = pool.length;
  console.log(`✅ Meeting pool ready (${ready}/${POOL_SIZE} pre-created)`);
  if (ready < POOL_SIZE) {
    console.log(`Pool is ${POOL_SIZE - ready} short; scheduling a heal.`);
    scheduleHeal(HEAL_ATTEMPTS);
  }
  return ready;
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
