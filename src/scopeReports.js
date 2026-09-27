import { fileIn, readJson, writeJson, listScopes } from "./dataPaths.js";
import { readScopeInfo } from "./scopeInfo.js";
import { loadSchedules } from "./scheduleStore.js";

/**
 * Derived views over each data folder, so you can see what a server has been
 * up to without reading raw records.
 *
 * Everything here is computed from files already on disk. Nothing is estimated
 * or carried forward: a counter that can't be read back reports null rather
 * than a plausible-looking number.
 */

const DAY_MS = 86_400_000;

const since = (iso) => (iso ? Date.now() - new Date(iso).getTime() : NaN);
const daysAgo = (iso) => {
  const ms = since(iso);
  return Number.isFinite(ms) ? Math.round((ms / DAY_MS) * 10) / 10 : null;
};

/** Meetings this scope has handed out, by age. */
export async function buildMeetingStats(scope) {
  const spaces = await readJson(fileIn(scope, "spaces.json"), []);
  const list = Array.isArray(spaces) ? spaces : [];
  const now = Date.now();

  const byDay = {};
  let earliest = null;
  for (const entry of list) {
    const at = entry?.at ? new Date(entry.at) : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    const key = at.toISOString().slice(0, 10);
    byDay[key] = (byDay[key] ?? 0) + 1;
    if (!earliest || at.getTime() < earliest.getTime()) earliest = at;
  }

  return {
    kind: "stats",
    totalMeetings: list.length,
    meetingsToday: Object.values(byDay).length ? byDay[new Date(now).toISOString().slice(0, 10)] ?? 0 : 0,
    firstMeetingAt: earliest ? earliest.toISOString() : null,
    lastMeetingAt: list[0]?.at ?? null,
    daysSinceFirst: daysAgo(earliest?.toISOString()),
    busiestDay: Object.entries(byDay).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    byDay,
    generatedAt: new Date().toISOString(),
  };
}

/** Pending /schedule entries, with the next run time. */
export async function buildScheduleStats(scope) {
  const schedules = await loadSchedules(scope);
  const now = Date.now();
  const pending = schedules.filter((s) => s && new Date(s.runAt).getTime() > now);
  const next = pending.sort((a, b) => new Date(a.runAt) - new Date(b.runAt))[0] ?? null;

  return {
    kind: "schedules",
    total: schedules.length,
    pending: pending.length,
    overdue: schedules.length - pending.length,
    nextRunAt: next?.runAt ?? null,
    nextRunTitle: next?.title ?? null,
    items: schedules.map((s) => ({
      id: s.id,
      runAt: s.runAt,
      title: s.title ?? null,
      channelId: s.channelId ?? null,
      notifyRoleId: s.notifyRoleId ?? null,
      requestedBy: s.requestedByTag ?? null,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/** Every JSON view for one scope, written into its folder. */
export async function writeScopeReports(scope) {
  const reports = [
    ["stats.json", buildMeetingStats],
    ["schedules-report.json", buildScheduleStats],
  ];
  const written = [];
  for (const [name, build] of reports) {
    try {
      await writeJson(fileIn(scope, name), await build(scope));
      written.push(name);
    } catch (err) {
      console.error(`Couldn't write ${name} for ${JSON.stringify(scope)}:`, err.message);
    }
  }
  return written;
}

/**
 * Refresh the derived files for every scope. Called on boot and on a slow
 * timer, so a folder left alone for a week still has a current summary.
 */
export async function refreshAllReports() {
  let scopes = 0;
  let files = 0;
  for (const found of await listScopes()) {
    const scope = found.guildId ? { guildId: found.guildId } : { userId: found.userId };
    scopes++;
    files += (await writeScopeReports(scope)).length;
  }
  return { scopes, files };
}
