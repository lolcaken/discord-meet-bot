import { fileIn, readJson, writeJson, listScopes } from "./dataPaths.js";

/**
 * Pending /schedule entries, one file per server (or per DM user).
 *
 * Each entry is remembered with the scope it belongs to, so a scheduled post
 * fires back into the right server even though the timer has no idea where it
 * came from.
 */

const file = (scope) => fileIn(scope, "schedules.json");

/** Every pending schedule across every scope, for the boot-time sweep. */
export async function loadAllSchedules() {
  const out = [];
  for (const scope of await listScopes()) {
    const scopeArg = scope.guildId ? { guildId: scope.guildId } : { userId: scope.userId };
    const entries = await readJson(file(scopeArg), []);
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === "object") out.push({ ...entry, __scope: scopeArg });
    }
  }
  return out;
}

/** Pending schedules in one scope. */
export async function loadSchedules(scope) {
  const entries = await readJson(file(scope), []);
  return Array.isArray(entries) ? entries : [];
}

/**
 * Adds a schedule and returns it with a generated id.
 * schedule: { runAt, channelId, guildId, title, notifyRoleId, requestedBy }
 */
export async function addSchedule(scope, schedule) {
  const schedules = await loadSchedules(scope);
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...schedule };
  await writeJson(file(scope), [...schedules, entry]);
  return entry;
}

/** Removes a schedule by id. Call this once it has fired. */
export async function removeSchedule(scope, id) {
  const schedules = await loadSchedules(scope);
  await writeJson(file(scope), schedules.filter((s) => s?.id !== id));
}
