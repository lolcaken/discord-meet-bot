import { fileIn, writeJson, readJson } from "./dataPaths.js";

/**
 * A human-readable record of who each data folder belongs to.
 *
 * A folder named 1550540829112795187 tells you nothing; server.json next to it
 * says "Bounty Hunters, 412 members, joined 2026-09-26". It matters most when
 * something goes wrong and you're reading files off a VPS trying to work out
 * which folder is whose.
 *
 * Guild details come from the gateway's own cache, so there's no extra API call
 * and nothing to rate-limit.
 */

const GUILD_FILE = "server.json";
const USER_FILE = "user.json";

const file = (scope, name) => fileIn(scope, name);

/** Compact, stable record of a server. */
export function describeGuild(guild, { isMainGuild = false } = {}) {
  const owner = guild.ownerId ? guild.members.cache.get(guild.ownerId) : null;
  return {
    kind: "guild",
    id: guild.id,
    name: guild.name ?? null,
    memberCount: guild.memberCount ?? null,
    ownerId: guild.ownerId ?? null,
    ownerUsername: owner?.user?.username ?? null,
    createdAt: guild.createdAt ? new Date(guild.createdAt).toISOString() : null,
    botJoinedAt: guild.joinedAt ? new Date(guild.joinedAt).toISOString() : null,
    iconUrl: guild.iconURL?.() ?? null,
    channels: guild.channels?.cache?.size ?? null,
    roles: guild.roles?.cache?.size ?? null,
    boostTier: guild.premiumTier ?? null,
    boostCount: guild.premiumSubscriptionCount ?? null,
    locale: guild.preferredLocale ?? null,
    isMainGuild,
    recordedAt: new Date().toISOString(),
  };
}

export async function writeGuildInfo(guild, options = {}) {
  const scope = { guildId: guild.id };
  const info = describeGuild(guild, options);
  await writeJson(file(scope, GUILD_FILE), info);
  return info;
}

/** Same idea for a DM folder, so those are identifiable too. */
export async function writeUserInfo(user) {
  const scope = { userId: user.id };
  const info = {
    kind: "user",
    id: user.id,
    username: user.username ?? null,
    globalName: user.globalName ?? null,
    displayName: user.displayName ?? user.username ?? null,
    accountCreatedAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
    isBot: Boolean(user.bot),
    recordedAt: new Date().toISOString(),
  };
  await writeJson(file(scope, USER_FILE), info);
  return info;
}

/** Read a folder's identity back, or null if it was never recorded. */
export async function readScopeInfo(scope) {
  return readJson(file(scope, GUILD_FILE), await readJson(file(scope, USER_FILE), null));
}

/**
 * Refresh every server profile from the live cache. Runs at boot, and again on a
 * timer, so counts and names don't go stale.
 */
export async function refreshAllGuildInfo(client, { isMainGuild }) {
  let written = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      await writeGuildInfo(guild, { isMainGuild: isMainGuild(guild.id) });
      written++;
    } catch (err) {
      // A single unreadable guild must not stop the rest.
      console.error(`Couldn't record info for server ${guild.id}:`, err.message);
    }
  }
  return written;
}
