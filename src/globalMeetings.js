import { getSpace, listParticipants } from "./googleMeet.js";
import { spacesForEveryGuild, allSpaces } from "./spaceRegistry.js";
import { readScopeInfo } from "./scopeInfo.js";

/**
 * The view across every server the bot is in.
 *
 * `last` answers "where are people right now" for one server. The global
 * commands answer the same question for all of them, and also want a roster:
 * who has been using the bot, and who is in the call right now.
 *
 * Everything here is read-only apart from the Meet API calls, which are the
 * same ones the participant counter already makes.
 */

/**
 * How many spaces to check per server when hunting for a live one.
 *
 * A server can have 50 recorded spaces (the registry's cap) and checking each
 * one costs an API call, so a live meeting is usually found within the first
 * few. This is a bound on work, not on correctness: the scan is newest-first,
 * so the most likely candidates are tried first.
 */
const CHECK_PER_GUILD = 8;

/**
 * Is anyone actually in this space right now?
 *
 * Returns the participant count, or null when the space can't be read at all
 * (wrong Google account, ended, deleted). null means "don't report it", which
 * is different from 0 meaning "it's live but empty".
 */
async function countInside(entry) {
  let space;
  try {
    space = await getSpace(entry.name);
  } catch {
    return null;
  }

  if (!space?.activeConference) return null;

  try {
    const { participants = [] } = await listParticipants(
      space.activeConference.conferenceRecord,
      { activeOnly: true }
    );
    return participants.length;
  } catch {
    return null;
  }
}

/**
 * Every live meeting across every server the bot is in, newest first within
 * each server.
 *
 * @param client the Discord client, used for server names
 * @param options.scope restrict to one guild (used by the per-server command)
 */
export async function liveMeetingsEverywhere(client, { scope = null, perGuild = CHECK_PER_GUILD } = {}) {
  const guilds = scope
    ? [{ guildId: scope, entries: await allSpaces({ guildId: scope }) }]
    : await spacesForEveryGuild();

  const found = [];
  for (const { guildId, entries } of guilds) {
    const guild = client.guilds.cache.get(guildId);
    const info = await readScopeInfo({ guildId });

    for (const entry of entries.slice(0, perGuild)) {
      const count = await countInside(entry);
      if (!count) continue; // null (unreadable) or 0 (nobody in it)

      found.push({
        guildId,
        guildName: guild?.name ?? info?.name ?? guildId,
        entry,
        count,
      });
      // One live meeting per server: the newest one with people in it. A server
      // with two live calls is rare, and reporting both would bury the answer.
      break;
    }
  }

  // Busiest call first, so the one with the most people in it is the one the
  // owner sees at the top.
  found.sort((a, b) => b.count - a.count || a.guildName.localeCompare(b.guildName));
  return found;
}

/**
 * The roster: who has used the bot, and where.
 *
 * `requestedBy` is the username that asked for each meeting, so this is a
 * record of who the bot has been working for - not Discord's member list,
 * which the bot can't read without the privileged intent.
 */
export async function rosterEverywhere(client, { scope = null } = {}) {
  const guilds = scope
    ? [{ guildId: scope, entries: await allSpaces({ guildId: scope }) }]
    : await spacesForEveryGuild();

  const rows = [];
  for (const { guildId, entries } of guilds) {
    const guild = client.guilds.cache.get(guildId);
    const info = await readScopeInfo({ guildId });

    const people = new Map();
    for (const entry of entries) {
      const who = entry.requestedBy ?? "unknown";
      const existing = people.get(who) ?? { name: who, meetings: 0, lastAt: null };
      existing.meetings++;
      if (!existing.lastAt || (entry.at && entry.at > existing.lastAt)) {
        existing.lastAt = entry.at ?? null;
      }
      people.set(who, existing);
    }

    rows.push({
      guildId,
      guildName: guild?.name ?? info?.name ?? guildId,
      memberCount: guild?.memberCount ?? info?.memberCount ?? null,
      totalMeetings: entries.length,
      people: [...people.values()].sort((a, b) => b.meetings - a.meetings),
    });
  }

  // The scopes come off the filesystem, whose order isn't guaranteed, so sort
  // them: busiest server first, then by name. The owner reads these lists and
  // they should not reshuffle between runs.
  rows.sort((a, b) => b.totalMeetings - a.totalMeetings || a.guildName.localeCompare(b.guildName));
  return rows;
}

/** Plain-text rendering of the global roster, trimmed to Discord's 2000. */
export function renderRoster(rows) {
  if (!rows.length) return "No meetings handed out yet, anywhere.";

  const lines = [`roster - ${rows.length} server(s)`];
  for (const row of rows) {
    lines.push("");
    lines.push(`${row.guildName} - ${row.totalMeetings} meeting(s)`);
    for (const person of row.people) {
      const when = person.lastAt ? person.lastAt.slice(0, 10) : "";
      lines.push(`   ${person.name} - ${person.meetings} meeting(s)${when ? ` - last ${when}` : ""}`);
    }
  }

  // Trim whole lines until it fits, rather than letting Discord reject it.
  while (lines.join("\n").length > 1950 && lines.length > 1) lines.pop();
  if (lines.join("\n").length > 1950) return "That roster is too long to show. Narrow it to one server.";
  return lines.join("\n");
}

/** Plain-text rendering of live meetings across servers. */
export function renderLiveMeetings(found) {
  if (!found.length) return "No people active rn lol";

  const lines = [`live meetings - ${found.length}`];
  for (const item of found) {
    lines.push("");
    lines.push(`${item.guildName}`);
    lines.push(`   ${item.entry.uri} - ${item.count} in it`);
  }

  while (lines.join("\n").length > 1950 && lines.length > 1) lines.pop();
  return lines.join("\n");
}
