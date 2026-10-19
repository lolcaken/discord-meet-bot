/**
 * The real regression guard for the bad-request bug: an interaction for a
 * command no branch handles must still get a reply.
 *
 * This runs the actual handleCommand against a fake interaction whose
 * commandName matches nothing, and asserts it answers exactly once. Falling
 * off the end with no reply is what makes Discord report "This interaction
 * failed" after its 3-second deadline.
 *
 * It extracts handleCommand from the source and runs it with stubbed helpers,
 * so no Discord connection or Google credentials are needed.
 */
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("src/index.js", "utf8");
const out = [];
const say = (s) => { out.push(s); writeFileSync("fallthrough-test.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)} ${detail}`);
};

// Pull handleCommand's source out of the file.
const start = src.indexOf("async function handleCommand");
const end = src.indexOf('client.on("interactionCreate"');
const fnSrc = src.slice(start, end);

// Stubs for everything handleCommand touches that isn't one of its branches.
const mk = () => {
  const replies = [];
  return {
    replies,
    interaction: {
      commandName: "roster",
      isTextCommand: false,
      deferred: false,
      replied: false,
      guildId: "1550540829112795187",
      channelId: "1550540830031224974",
      user: { username: "tester", id: "1" },
      channel: { send: async () => ({}) },
      guild: { id: "1550540829112795187" },
      options: { getString: () => null, getInteger: () => null, getRole: () => null },
      async deferReply() { this.deferred = true; },
      async reply(payload) { this.replied = true; replies.push(payload); return {}; },
      async editReply(payload) { replies.push(payload); return {}; },
    },
  };
};

// Build a runnable handleCommand from the real source.
const build = new Function(
  "deps",
  `
  const {
    isMainGuild, MAIN_GUILD_ID, PRELOADED_MEETS, handleLast, handleServers,
    safeReply, logEvent, logFailure, logDenied, logBlocked, logMeetCreated,
    logScheduled, logEnded, logReady, secondsLeft, cooldownRemaining,
    markPosted, scopeOf, where, resolveGuildRoom, getOrCreateGuildRoom,
    meetPost, watchParticipants, rememberSpace, latestSpace, recentSpaces,
    getSpace, listParticipants, endActiveConference, takeMeetingWithCooldown,
    resolveSpace, rebuildInventory, renderInventory, apiHint, NO_MEETING,
    checkAllowed, MAX_SCHEDULE_MINUTES, describeScope,
    logCommand, roomCodeFor, fireSchedule,
  } = deps;
  ${fnSrc}
  return handleCommand;
  `
);

const noop = () => {};
const errors = [];
const deps = {
  isMainGuild: () => true, MAIN_GUILD_ID: "1550540829112795187", PRELOADED_MEETS: {},
  handleLast: noop, handleServers: noop,
  safeReply: async (i, p) => { i.reply(p); },
  logEvent: noop, logFailure: (d) => { errors.push(d); }, logDenied: noop, logBlocked: noop,
  logMeetCreated: noop, logScheduled: noop, logEnded: noop, logReady: noop,
  secondsLeft: () => "5", cooldownRemaining: () => 0, markPosted: noop,
  scopeOf: () => ({ guildId: "1550540829112795187" }), where: () => ({}),
  resolveGuildRoom: noop, getOrCreateGuildRoom: noop, meetPost: () => ({}),
  watchParticipants: noop, rememberSpace: noop, latestSpace: noop, recentSpaces: noop,
  getSpace: noop, listParticipants: noop, endActiveConference: noop,
  takeMeetingWithCooldown: noop, resolveSpace: noop,
  rebuildInventory: noop, renderInventory: () => "", apiHint: () => "", NO_MEETING: "",
  checkAllowed: noop, MAX_SCHEDULE_MINUTES: 10080, describeScope: async () => {},
  logCommand: noop, roomCodeFor: () => null, fireSchedule: noop,
};

let handleCommand;
try {
  handleCommand = build(deps);
  check("handleCommand loads", true, "");
} catch (err) {
  check("handleCommand loads", false, err.message.slice(0, 80));
  say(`\n${fail} FAILED`);
  process.exit(1);
}

say("=== an unknown command must still answer ===");
const a = mk();
await handleCommand(a.interaction);
check("it replied", a.replies.length > 0, `${a.replies.length} reply`);
const body = typeof a.replies[0] === "string" ? a.replies[0] : a.replies[0]?.content ?? "";
check("the reply names the command", body.includes("roster"), body.slice(0, 60));
check("it did not hang", true);
if (errors.length) say(`      failure detail: ${JSON.stringify(errors[errors.length - 1]).slice(0, 240)}`);

say("\n=== different unknown commands all answer ===");
for (const name of ["roster", "history", "artifacts", "notacommand"]) {
  const m = mk();
  m.interaction.commandName = name;
  await handleCommand(m.interaction);
  check(`"${name}" replies`, m.replies.length === 1, `${m.replies.length}`);
}

say("\n=== a command with no name at all still answers ===");
const anon = mk();
anon.interaction.commandName = undefined;
await handleCommand(anon.interaction);
check("undefined commandName replies", anon.replies.length === 1, `${anon.replies.length}`);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;