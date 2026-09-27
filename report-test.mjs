/**
 * The per-folder JSON: server identity, derived stats, and errorlog.json.
 * Runs against a throwaway DATA_DIR.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "meetbot-reports-"));
process.env.DATA_DIR = tmp;
// Keep the logger away from the real log dir and the real webhook.
process.env.DISCORD_LOG_WEBHOOK_URL = "";

const out = [];
const say = (s) => { out.push(s); writeFileSync("report-test.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const G = "111111111111111111";
const scope = { guildId: G };
mkdirSync(path.join(tmp, "guilds", G), { recursive: true });

const { writeGuildInfo, readScopeInfo, describeGuild } = await import("./src/scopeInfo.js");
const { buildMeetingStats, buildScheduleStats, writeScopeReports, refreshAllReports } =
  await import("./src/scopeReports.js");

say("--- server.json ---");
// A stand-in for the gateway's guild object, with the fields we actually read.
const fakeGuild = {
  id: G,
  name: "Bounty Hunters",
  memberCount: 412,
  ownerId: "999",
  createdAt: new Date("2024-01-02T03:04:05Z"),
  joinedAt: new Date("2026-09-01T00:00:00Z"),
  iconURL: () => "https://cdn.discordapp.com/icons/1/abc.png",
  channels: { cache: new Map([[1, 1], [2, 2]]) },
  roles: { cache: new Map([[1, 1]]) },
  premiumTier: 2,
  premiumSubscriptionCount: 7,
  preferredLocale: "en-US",
  members: { cache: new Map([["999", { user: { username: "lolcaken" } }]]) },
};
const info = await writeGuildInfo(fakeGuild, { isMainGuild: true });
check("name recorded", info.name, "Bounty Hunters");
check("member count", info.memberCount, 412);
check("owner resolved from cache", info.ownerUsername, "lolcaken");
check("main guild flagged", info.isMainGuild, true);
check("joinedAt is ISO", info.botJoinedAt, "2026-09-01T00:00:00.000Z");
check("channel count", info.channels, 2);
check("icon url kept", Boolean(info.iconUrl), true);
check("file written", existsSync(path.join(tmp, "guilds", G, "server.json")), true);
check("reads back", (await readScopeInfo(scope)).name, "Bounty Hunters");
check("missing fields stay null, not invented", describeGuild({ id: G }).memberCount, null);

say("\n--- stats.json, computed not invented ---");
const now = new Date();
const days = (n) => new Date(now.getTime() - n * 86_400_000).toISOString();
writeFileSync(path.join(tmp, "guilds", G, "spaces.json"), JSON.stringify([
  { name: "spaces/a", code: "aaa-bbb-ccc", at: days(0) },
  { name: "spaces/b", code: "ddd-eee-fff", at: days(0) },
  { name: "spaces/c", code: "ggg-hhh-iii", at: days(3) },
]), "utf8");

const stats = await buildMeetingStats(scope);
check("total meetings", stats.totalMeetings, 3);
check("today's count", stats.meetingsToday, 2);
check("busiest day recorded", stats.byDay[days(0).slice(0, 10)], 2);
check("days since first is a number", typeof stats.daysSinceFirst, "number");
check("never claims a date it lacks", stats.firstMeetingAt !== null, true);
const empty = await buildMeetingStats({ guildId: "222222222222222222" });
check("empty scope reports 0, not null", empty.totalMeetings, 0);
check("empty scope has no first meeting", empty.firstMeetingAt, null);

say("\n--- schedules-report.json ---");
writeFileSync(path.join(tmp, "guilds", G, "schedules.json"), JSON.stringify([
  { id: "s1", runAt: new Date(now.getTime() + 3600_000).toISOString(), title: "Standup", channelId: "c1" },
  { id: "s2", runAt: new Date(now.getTime() - 3600_000).toISOString(), title: "Overdue", channelId: "c1" },
]), "utf8");
const sched = await buildScheduleStats(scope);
check("counts both entries", sched.items.length, 2);
check("total recorded", sched.total, 2);
check("one still pending", sched.pending, 1);
check("one overdue", sched.overdue, 1);
check("pending + overdue = total", sched.pending + sched.overdue, sched.total);
check("next run is the future one", new Date(sched.nextRunAt) > new Date(), true);

say("\n--- refresh writes both files into every scope ---");
const written = await writeScopeReports(scope);
check("two files written", written.sort(), ["schedules-report.json", "stats.json"]);
const summary = await refreshAllReports();
check("one scope refreshed", summary.scopes, 1);
check("two files across it", summary.files, 2);

say("\n--- errorlog.json ---");
const { logEvent, logFailure, logBlocked } = await import("./src/logger.js");
const errFile = path.join("logs", "errorlog.json");
rmSync(errFile, { force: true });
const before = existsSync("logs/activity.log") ? readFileSync("logs/activity.log", "utf8") : "";
const afterActivity = before;

await logEvent("info", "should.not.appear", {});
check("info writes no errorlog.json", existsSync(errFile), false);
await logBlocked({ command: "meet", reason: "cooldown" });
check("warn writes no errorlog.json", existsSync(errFile), false);
await logFailure({ command: "/meet", reason: "429 quota", guildId: G });
check("error creates errorlog.json", existsSync(errFile), true);
const errs = JSON.parse(readFileSync(errFile, "utf8"));
check("errors are an array", Array.isArray(errs), true);
check("newest first", errs[0].event, "command.failed");
check("reason preserved", errs[0].reason, "429 quota");
await logFailure({ command: "/end", reason: "second" });
check("appends, newest first", JSON.parse(readFileSync(errFile, "utf8"))[0].reason, "second");
check("has ISO timestamp", /^\d{4}-/.test(JSON.parse(readFileSync(errFile, "utf8"))[0].ts), true);

// The cap has to hold, or the rewrite grows forever.
for (let i = 0; i < 205; i++) await logFailure({ command: "/meet", reason: `bulk ${i}` });
const capped = JSON.parse(readFileSync(errFile, "utf8"));
check("capped at 200 entries", capped.length, 200);
check("newest survived the cap", capped[0].reason, "bulk 204");

// Restore the real activity log; this test appended to it.
const { writeFileSync: wf } = await import("node:fs");
wf("logs/activity.log", afterActivity, "utf8");
rmSync(errFile, { force: true });
for (const f of (await import("node:fs")).readdirSync("logs")) {
  if (f.startsWith("activity.log.")) rmSync(path.join("logs", f), { force: true });
}

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
rmSync(tmp, { recursive: true, force: true });
process.exitCode = fail ? 1 : 0;
