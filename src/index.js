import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType,
} from "discord.js";
import {
  warmUpAuth,
  getSpace,
  endActiveConference,
  listParticipants,
} from "./googleMeet.js";
import { initPool, takeMeeting } from "./meetingPool.js";
import { addSchedule, loadSchedules, removeSchedule } from "./scheduleStore.js";
import { rememberSpace, latestSpace } from "./spaceRegistry.js";
import { PRELOADED_MEETS } from "./preloadedMeets.js";
import { parseTextCommand } from "./textCommands.js";
import { logMeetingCreated } from "./logger.js";

if (!process.env.DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN in your .env file. Can't start the bot.");
  process.exit(1);
}

// Without these, a single bad promise or a websocket hiccup would otherwise
// silently kill the whole process (modern Node exits on unhandled
// rejections by default, and EventEmitter 'error' events with no listener
// throw). Logging and continuing keeps the bot alive through transient
// issues instead of needing a manual restart every time.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection (bot is still running):", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (bot is still running):", err);
});

const GOOGLE_MEET_LOGO_URL =
  "https://fonts.gstatic.com/s/i/productlogos/meet_2020q4/v6/web-96dp/logo_meet_2020q4_color_2x_web_96dp.png";

// setTimeout can't reliably wait longer than ~24.8 days; we cap well under
// that and re-check schedules periodically instead of relying on one giant
// timer, so this survives being wrong by a few minutes at worst.
const MAX_SCHEDULE_MINUTES = 10080; // 7 days
const RECHECK_INTERVAL_MS = 60_000; // re-scan schedules every minute

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    // Required for plain-text commands ("meet", "rand") to be readable in
    // servers. Without it Discord silently sends no message content and the
    // text path never fires, while the slash commands keep working.
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});
const pendingTimers = new Set();

client.on("error", (err) => console.error("Discord client error:", err));
client.on("shardError", (err) => console.error("Discord shard error:", err));

/** Best-effort reply helper: never throws, so a failed error-reply can't crash anything. */
async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply(payload);
  } catch (err) {
    console.error("Failed to send a reply to Discord:", err);
    return undefined;
  }
}

// Live participant count under the link. Meet only fills in a space's
// `activeConference` once someone joins, and each participant's
// `latest_end_time` flips from null to a timestamp as they come and go, so the
// honest number has to be re-read on a timer. A one-shot tick latches on first
// sight and stays stuck at "yes" long after everyone has left.
const COUNTER_EMOJI = "\u{1F464}"; // ??
const PARTICIPANT_POLL_MS = 15_000;
const PARTICIPANT_WATCH_MS = 2 * 60 * 60 * 1000;

async function watchParticipants(message, spaceRef) {
  if (!message || !spaceRef) return;

  // The body stays byte-identical to what was posted; the count lives on its
  // own line underneath, so an edit can only ever replace that one line.
  const base = message.content;
  let current = base;

  const update = async () => {
    let count = 0;
    const space = await getSpace(spaceRef);
    if (space?.activeConference) {
      const { participants = [] } = await listParticipants(
        space.activeConference.conferenceRecord,
        { activeOnly: true }
      );
      count = participants.length;
    }

    const next = `${base}\n${COUNTER_EMOJI} ${count}`;
    if (next === current) return;
    current = next;
    // parse: [] stops the edit re-pinging @everyone on every poll.
    await message.edit({ content: next, allowedMentions: { parse: [] } });
  };

  const startedAt = Date.now();
  const timer = setInterval(async () => {
    if (Date.now() - startedAt > PARTICIPANT_WATCH_MS) {
      clearInterval(timer);
      return;
    }
    try {
      await update();
    } catch (err) {
      // A space this account can't read (wrong Google account) 403s forever,
      // so stop rather than poll for two hours. One line, not a JSON dump.
      clearInterval(timer);
      const status = /\((\d+)\)/.exec(err.message)?.[1] ?? "?";
      console.error(`Participant count stopped for ${spaceRef} (HTTP ${status})`);
    }
  }, PARTICIPANT_POLL_MS);

  // Show the line straight away instead of leaving it absent for 15s.
  update().catch(() => {});
}

const NO_MEETING =
  "?? No meeting here yet. Run `/meet` first, or paste a link created by this bot's meet maker.";

/**
 * The one and only shape a posted meeting takes: an @everyone ping, a nudge,
 * and the bare link. Every path — /meet, /rand and the preloaded links — goes
 * through here so they can't drift apart.
 */
const meetPost = (uri) => ({
  content: `@everyone join meet!!\n${uri}`,
  allowedMentions: { parse: ["everyone"] },
});

/** Google API errors are JSON blobs; show the part a human can act on. */
function apiHint(err) {
  if (/no active conference/i.test(err.message)) return "Nobody is in that call right now — nothing to end.";
  if (/\(403\)/.test(err.message)) return "Google refused the request — the OAuth token may lack this scope.";
  if (/\(404\)/.test(err.message)) return "Google couldn't find that meeting space.";
  if (/\(429\)/.test(err.message)) return "Rate limited by Google (meetings created per minute). Try again in a moment.";
  if (/\(401\)|unauthorized|invalid_grant/i.test(err.message)) return "The Google OAuth token expired — re-run `npm run auth`.";
  return "Check the bot's logs for details.";
}

/**
 * The space /end acts on: an explicit `code` option if given, otherwise the
 * most recent meeting handed out in this channel.
 */
async function resolveSpace(interaction) {
  const code = interaction.options.getString("code");
  if (code) {
    const match = code.toLowerCase().match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/)?.[0];
    return match ? { name: `spaces/${match}`, code: match } : null;
  }
  return latestSpace(interaction.channelId);
}

function buildMeetEmbed({ space, title, requestedByTag }) {
  const embed = new EmbedBuilder()
    .setAuthor({ name: "Google Meet", iconURL: GOOGLE_MEET_LOGO_URL })
    .setTitle(title ?? null)
    .setURL(space.meetingUri)
    .setThumbnail(GOOGLE_MEET_LOGO_URL)
    .setDescription(
      `**${space.meetingUri}**\n\nMeeting code: \`${space.meetingCode}\``
    )
    .setColor(0x00897b)
    .setFooter({ text: `Requested by ${requestedByTag}` })
    .setTimestamp();

  const joinButton = new ButtonBuilder()
    .setLabel("Join Meeting")
    .setStyle(ButtonStyle.Link)
    .setURL(space.meetingUri)
    .setEmoji("??");

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(joinButton)] };
}

async function fireSchedule(schedule) {
  await removeSchedule(schedule.id); // remove first so a crash can't loop-fire it
  try {
    const channel = await client.channels.fetch(schedule.channelId);
    const space = await takeMeeting();
    const { embeds, components } = buildMeetEmbed({
      space,
      title: schedule.title,
      requestedByTag: schedule.requestedByTag,
    });

    const content = schedule.notifyRoleId ? `<@&${schedule.notifyRoleId}>` : undefined;
    await channel.send({ content, embeds, components });

    await rememberSpace({
      name: space.name,
      code: space.meetingCode,
      uri: space.meetingUri,
      channelId: schedule.channelId,
      requestedBy: schedule.requestedByTag,
    });

    await logMeetingCreated({
      username: schedule.requestedByTag,
      userId: schedule.requestedById,
      context: channel.guild ? `#${channel.name} in ${channel.guild.name}` : "DM",
      meetingUri: space.meetingUri,
      meetingCode: space.meetingCode,
      via: "/schedule",
    });
  } catch (err) {
    console.error(`Failed to fire scheduled meeting ${schedule.id}:`, err);
  }
}

function scheduleTimer(schedule) {
  const delay = new Date(schedule.runAt).getTime() - Date.now();
  if (delay > MAX_SCHEDULE_MINUTES * 60_000) return; // will be picked up by recheck loop later
  if (pendingTimers.has(schedule.id)) return;

  pendingTimers.add(schedule.id);
  setTimeout(() => {
    pendingTimers.delete(schedule.id);
    fireSchedule(schedule);
  }, Math.max(delay, 0));
}

async function scanAndArm() {
  const schedules = await loadSchedules();
  const now = Date.now();
  for (const schedule of schedules) {
    if (new Date(schedule.runAt).getTime() <= now) {
      await fireSchedule(schedule); // overdue (e.g. bot was offline) — fire immediately
    } else {
      scheduleTimer(schedule);
    }
  }
}

client.once("ready", async () => {
  console.log(`? Logged in as ${client.user.tag}`);

  client.user.setPresence({
    status: "online",
    activities: [{ name: "Custom Status", type: ActivityType.Custom, state: "💢" }],
  });

  // Printed on every boot so the log proves which build is live: if this line
  // is missing, the running process predates the cooldown and needs a restart.
  console.log(
    `⏱️ Cooldown: ${MEET_COOLDOWN_S}s per channel (applies to /meet and rand)`
  );


  await warmUpAuth();
  await initPool();
  await scanAndArm();
  setInterval(scanAndArm, RECHECK_INTERVAL_MS);
});

/**
 * Minimum seconds between two meeting posts, per channel.
 *
 * Two separate gates, because they guard different things:
 *
 *   "new"       - /meet and rand mint a space, and every creation counts
 *                 against Google's CreateSpacePerMinutePerUser quota. A burst
 *                 can exhaust it and fail the command outright with a 429.
 *   "preloaded" - cd and meet2-4 just repost a fixed URL, so there's no quota
 *                 to protect. This gate exists to stop channel spam.
 *
 * Scoped per channel on purpose: two busy channels shouldn't block each other,
 * and one chatty channel is where the spam actually comes from.
 */
const MEET_COOLDOWN_S = 5;
const lastPostAt = { new: new Map(), preloaded: new Map() };

function cooldownRemaining(gate, channelId) {
  const last = lastPostAt[gate].get(channelId);
  if (last === undefined) return 0;
  const elapsed = (Date.now() - last) / 1000;
  return elapsed >= MEET_COOLDOWN_S ? 0 : MEET_COOLDOWN_S - elapsed;
}

function markPosted(gate, channelId) {
  lastPostAt[gate].set(channelId, Date.now());
  // Don't let a long-lived process accumulate one entry per channel seen.
  const seen = lastPostAt[gate];
  if (seen.size > 200) {
    const cutoff = Date.now() - MEET_COOLDOWN_S * 1000;
    for (const [id, at] of seen) {
      if (at < cutoff) seen.delete(id);
    }
  }
}

/** Mints a new space, gated by the quota-protecting "new" cooldown. */
async function takeMeetingWithCooldown(interaction) {
  const wait = cooldownRemaining("new", interaction.channelId);
  if (wait > 0) {
    await safeReply(interaction, `${secondsLeft(wait)} left`);
    return null;
  }
  markPosted("new", interaction.channelId);
  return takeMeeting();
}

/** Whole seconds, rounded up so it never says "0" while still blocking. */
function secondsLeft(wait) {
  return `${Math.ceil(wait)} second${Math.ceil(wait) === 1 ? "" : "s"}`;
}

/**
 * Every command body, driven by one small interface so the slash-command
 * path and the plain-text path run identical code. Only these members are
 * touched, which is what lets a Message be adapted into an interaction.
 */
async function handleCommand(interaction) {
  {
    try {
    // Typed commands are matched FIRST, and deliberately so. A typed `meet`
    // carries the same commandName as the slash /meet, so if the /meet branch
    // were checked first it would swallow it and hand out a random pooled
    // link — exactly the behaviour typed `meet` must never have. Handling the
    // text path up front also keeps `meet2`-`meet4` from falling through.
    //
    // Only falls through when the typed word isn't a meet, because typed
    // `rand` continues on to its own branch.
    if (interaction.isTextCommand) {
      const name = interaction.commandName ?? "";
      // Matched on the word, not merely "is it text": a typed `rand` is also
      // a text command, and it must fall through to its own random branch.
      const slot = /^meet(?:([2-9]|[1-9][0-9]+))?$/.exec(name);
      if (slot) {
        const code = PRELOADED_MEETS[slot[1] ?? "1"];
        if (!code) return;

        // Anti-spam gate. Separate from the "new" gate on purpose: reposting
        // a fixed link burns no quota, so it shouldn't lock you out of /meet.
        const wait = cooldownRemaining("preloaded", interaction.channelId);
        if (wait > 0) {
          await safeReply(interaction, `${secondsLeft(wait)} left`);
          return;
        }
        markPosted("preloaded", interaction.channelId);

        const message = await safeReply(interaction, meetPost(`https://meet.google.com/${code}`));

        // Live count. Every preloaded code was minted through this project's
        // own token, so the Meet API lets us read the space and count who's
        // in it. The watch logs one line and stops if a read ever fails.
        watchParticipants(message, `spaces/${code}`);
        return;
      }
    }

    if (interaction.commandName === "meet") {
      await interaction.deferReply(); // Meet API call can take a second or two

      try {
        const space = await takeMeetingWithCooldown(interaction);
        if (!space) return; // cooling down; already replied

        const message = await interaction.editReply(meetPost(space.meetingUri));

        watchParticipants(message, space.name);

        await rememberSpace({
          name: space.name,
          code: space.meetingCode,
          uri: space.meetingUri,
          channelId: interaction.channelId,
          requestedBy: interaction.user.username,
        });

        await logMeetingCreated({
          username: interaction.user.username,
          userId: interaction.user.id,
          context: interaction.guild
            ? `#${interaction.channel?.name ?? "unknown"} in ${interaction.guild.name}`
            : "DM / user-installed context",
          meetingUri: space.meetingUri,
          meetingCode: space.meetingCode,
          via: "/meet",
        });
      } catch (err) {
        console.error("Failed to create Meet space:", err);
        await safeReply(interaction,
          "? Couldn't create a Meet link. Check the bot's logs — this usually " +
            "means the Google OAuth token expired or the Meet API isn't enabled " +
            "on the Google Cloud project."
        );
      }
      return;
    }

    if (interaction.commandName === "rand") {
      await interaction.deferReply();

      try {
        const space = await takeMeetingWithCooldown(interaction);
        if (!space) return; // cooling down; already replied
        const message = await interaction.editReply(meetPost(space.meetingUri));
        watchParticipants(message, space.name);

        await rememberSpace({
          name: space.name,
          code: space.meetingCode,
          uri: space.meetingUri,
          channelId: interaction.channelId,
          requestedBy: interaction.user.username,
        });

        await logMeetingCreated({
          username: interaction.user.username,
          userId: interaction.user.id,
          context: interaction.guild
            ? `#${interaction.channel?.name ?? "unknown"} in ${interaction.guild.name}`
            : "DM / user-installed context",
          meetingUri: space.meetingUri,
          meetingCode: space.meetingCode,
          via: "/rand",
        });
      } catch (err) {
        console.error("Failed to create Meet space for /rand:", err);
        await safeReply(interaction, "? Couldn't create a meeting. " + apiHint(err));
      }
      return;
    }

    if (interaction.commandName === "schedule") {
      const minutes = interaction.options.getInteger("minutes");
      const title = interaction.options.getString("title");
      const notifyRole = interaction.options.getRole("notify");

      if (minutes < 1 || minutes > MAX_SCHEDULE_MINUTES) {
        await safeReply(interaction, {
          content: `?? Please pick a time between 1 and ${MAX_SCHEDULE_MINUTES} minutes (${Math.floor(
            MAX_SCHEDULE_MINUTES / 1440
          )} days) from now.`,
          ephemeral: true,
        });
        return;
      }

      const runAt = new Date(Date.now() + minutes * 60_000);

      const schedule = await addSchedule({
        runAt: runAt.toISOString(),
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        title,
        notifyRoleId: notifyRole?.id ?? null,
        requestedByTag: interaction.user.username,
        requestedById: interaction.user.id,
      });

      scheduleTimer(schedule);

      const unixSeconds = Math.floor(runAt.getTime() / 1000);
      await safeReply(interaction,
        `? Meeting${title ? ` "${title}"` : ""} scheduled for <t:${unixSeconds}:F> ` +
          `(<t:${unixSeconds}:R>). I'll post a fresh link here when it's time` +
          `${notifyRole ? `, and ping ${notifyRole}` : ""}.`
      );
      return;
    }

    if (interaction.commandName === "end") {
      await interaction.deferReply();

      const space = await resolveSpace(interaction);
      if (!space) return void (await safeReply(interaction, NO_MEETING));

      try {
        // No active conference means nobody ever joined — not a failure.
        const current = await getSpace(space.name);
        if (!current.activeConference) {
          return void (await safeReply(interaction, `? Nobody has joined \`${space.code}\` yet, so there's no call to end.`));
        }

        await endActiveConference(space.name);
        await safeReply(interaction, `?? Ended the call in \`${space.code}\`. Everyone still in it was dropped.`);
      } catch (err) {
        console.error("Failed to end active conference:", err);
        // Everyone can leave between the check above and the call landing,
        // in which case Google answers FAILED_PRECONDITION, not an error
        // worth shouting about.
        if (/no active conference/i.test(err.message)) {
          return void (await safeReply(interaction, `? Everyone had already left \`${space.code}\`.`));
        }
        await safeReply(interaction, "? Couldn't end the meeting. " + apiHint(err));
      }
      return;
    }
  } catch (err) {
    // Belt-and-braces: whatever went wrong, don't let it escape and take
    // the bot down — log it and let the user know something failed.
    console.error("Unexpected error handling command:", err);
    await safeReply(interaction, "? Something went wrong running that command.");
  }
  }
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await handleCommand(interaction);
});

/**
 * Adapts a plain-text command in a server into the shape handleCommand
 * expects, so `/meet` and a typed "meet" run the exact same code path.
 *
 * Only ever used in guilds: in a DM the slash command is just as easy to
 * type, and text commands in DMs are a spam risk with no upside.
 */
function textCommandFrom(message, parsed) {
  const options = parsed.options;
  let sent = null;

  return {
    commandName: parsed.name,
    user: message.author,
    channelId: message.channelId,
    guildId: message.guild?.id ?? null,
    guild: message.guild,
    channel: message.channel,
    isTextCommand: true,
    deferred: false,
    replied: false,
    // Messages have no 3-second interaction deadline, so a plain reply is
    // already fast enough; the API call happens after it goes out.
    async deferReply() {
      this.deferred = true;
    },
    async reply(payload) {
      this.replied = true;
      sent = await message.reply(payload);
      return sent;
    },
    async editReply(payload) {
      if (sent) return sent.edit(payload);
      return this.reply(payload);
    },
    options: {
      getString: (key) => (options[key] === undefined ? null : String(options[key])),
      getInteger: (key) => (options[key] === undefined ? null : Number(options[key])),
      // Nothing sensible to hand back for a role from typed text; the only
      // command using it is /schedule, which treats null as "don't ping".
      getRole: () => null,
    },
  };
}

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot || !message.guild) return; // servers only
    const parsed = parseTextCommand(message.content);
    if (!parsed) return;
    await handleCommand(textCommandFrom(message, parsed));
  } catch (err) {
    console.error("Failed to handle text command:", err);
  }
});

client.login(process.env.DISCORD_TOKEN);
