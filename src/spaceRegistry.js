import { fileIn, readJson, writeJson, listScopes } from "./dataPaths.js";

/**
 * Meetings the bot handed out, one file per server (or per DM user), so
 * /end can say what "the latest meeting" means.
 *
 * Scoping this per server is the point: a shared file meant /end in one server
 * could drop a call that was started in another, because it only ever matched
 * on channel, and a DM and a server with the same channel name were
 * indistinguishable.
 *
 * Deliberately separate from schedules.json: schedules are single-use pending
 * work, this is a rolling history, and letting one overwrite the other is how
 * you lose data.
 */

const MAX_ENTRIES = 50;

const file = (scope) => fileIn(scope, "spaces.json");

/**
 * Records a space. `scope` is { guildId } in a server or { userId } in a DM;
 * entry is { name, code, uri, channelId, requestedBy }.
 */
export async function rememberSpace(scope, entry) {
  const target = file(scope);
  const entries = await readJson(target, []);
  const next = [
    { ...entry, at: new Date().toISOString() },
    ...(Array.isArray(entries) ? entries : []).filter((e) => e?.name !== entry?.name),
  ].slice(0, MAX_ENTRIES);

  await writeJson(target, next);
  return next;
}

/** Most recently handed-out space in a scope, optionally within one channel. */
export async function latestSpace(scope, channelId) {
  const entries = await readJson(file(scope), []);
  if (!Array.isArray(entries) || !entries.length) return null;
  if (channelId) {
    const inChannel = entries.find((e) => e?.channelId && e.channelId === channelId);
    if (inChannel) return inChannel;
  }
  return entries[0] ?? null;
}

/**
 * Every space in a scope, newest first, with no limit and no channel
 * preference.
 *
 * `last` uses this rather than a "recent few" list: the point of `last` is
 * "wherever people are right now", and a meeting posted in another channel of
 * the same server is just as real as one in the channel you happen to be
 * typing in.
 */
export async function allSpaces(scope) {
  const entries = await readJson(file(scope), []);
  return Array.isArray(entries) ? entries : [];
}

/**
 * Every guild scope that has ever handed out a meeting, with its spaces.
 *
 * This is what the global commands walk: the bot may be in a dozen servers,
 * and each keeps its own spaces.json. DM scopes are skipped - a DM meeting
 * isn't a server meeting, and the owner asking "what servers am I in" means
 * servers.
 */
export async function spacesForEveryGuild() {
  const scopes = await listScopes();
  const out = [];
  for (const scope of scopes) {
    if (!scope.guildId) continue;
    const entries = await allSpaces({ guildId: scope.guildId });
    if (entries.length) out.push({ guildId: scope.guildId, entries });
  }
  return out;
}
