import { fileIn, readJson, writeJson } from "./dataPaths.js";

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
