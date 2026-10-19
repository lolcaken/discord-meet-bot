import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import {
  REST,
  Routes,
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} from "discord.js";
import { readJson, writeJson, DATA_ROOT } from "./dataPaths.js";
import { commandEnabled, loadConfig, configPath, hasConfigFile } from "./config.js";

// Load .env from the app's own folder rather than the working directory. A
// panel may start the app from anywhere, and without this the deploy would
// fail with "missing token" even though the credentials are right there.
const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(APP_DIR, ".env") });

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

/**
 * Where the "already registered this exact set" fingerprint lives. It sits
 * with the rest of the bot's data, so a fresh box re-registers once and then
 * settles down.
 */
const STATE_FILE = path.join(DATA_ROOT, "commands-deployed.json");

/** True when this file is the entry point, rather than imported by something. */
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

// Lets people install this bot to their own Discord account ("User App")
// and use it in any server or DM — not just servers where the bot was
// invited as a regular guild bot.
const INTEGRATION_TYPES = [
  ApplicationIntegrationType.GuildInstall,
  ApplicationIntegrationType.UserInstall,
];
const CONTEXTS = [
  InteractionContextType.Guild,
  InteractionContextType.BotDM,
  InteractionContextType.PrivateChannel,
];

// The command list, each with the config.json key that switches it off.
//
// The builders are kept as a plain list and filtered when registering, rather
// than being built conditionally, so the shape of a command never depends on
// the config: turning one off can't change another one.
const ALL_COMMANDS = [
  new SlashCommandBuilder()
    .setName("meet")
    .setDescription("Generate a MEETING LINK.")
    .setIntegrationTypes(INTEGRATION_TYPES)
    .setContexts(CONTEXTS)
    .addStringOption((option) =>
      option
        .setName("title")
        .setDescription("Optional label shown in the bot's reply")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Schedule a Google Meet link to be posted here later")
    .setIntegrationTypes(INTEGRATION_TYPES)
    .setContexts(CONTEXTS)
    .addIntegerOption((option) =>
      option
        .setName("minutes")
        .setDescription("How many minutes from now to post the link")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10080)
    )
    .addStringOption((option) =>
      option
        .setName("title")
        .setDescription("Optional label for the meeting")
        .setRequired(false)
    )
    .addRoleOption((option) =>
      option
        .setName("notify")
        .setDescription("Role to ping when the meeting link is posted")
        .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("end")
    .setDescription("End the live call in the latest meeting, dropping everyone in it")
    .setIntegrationTypes(INTEGRATION_TYPES)
    .setContexts(CONTEXTS)
    .addStringOption((option) =>
      option
        .setName("code")
        .setDescription("Optional meeting code, if it's not the latest one here")
        .setRequired(false)
    )
    .toJSON(),


  new SlashCommandBuilder()
    .setName("rand")
    .setDescription("Post a random fresh meeting link from the pool")
    .setIntegrationTypes(INTEGRATION_TYPES)
    .setContexts(CONTEXTS)
    .toJSON(),

  // Deliberately guild-only and not user-installable: it names every server
  // the bot is in, which isn't something to expose in a DM or to a user install.
  new SlashCommandBuilder()
    .setName("servers")
    .setDescription("List every server this bot is in (main server only)")
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .toJSON(),

  // Owner-only, and Discord enforces that too: setDefaultMemberPermissions to
  // 0 means the command is invisible and unusable to everyone else, so nobody
  // in any server even sees it in the palette. The handler still checks, in
  // case someone types it as plain text.
  new SlashCommandBuilder()
    .setName("roster")
    .setDescription("Show who has used the bot in this server (owner only)")
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(0)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("globalroster")
    .setDescription("Show who has used the bot across every server (owner only)")
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(0)
    .toJSON(),

  new SlashCommandBuilder()
    .setName("globallast")
    .setDescription("Show every live meeting across every server (owner only)")
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(0)
    .toJSON(),
];

/**
 * The commands that are switched on in config.json.
 *
 * A command that's off isn't registered with Discord at all, so it doesn't
 * appear in anyone's palette - and because registering replaces the whole
 * list, turning one off here actually removes it from Discord too.
 */
export function enabledCommands() {
  return ALL_COMMANDS.filter((c) => commandEnabled(c.name));
}

/** Every command the bot knows about, on or off. Used by the tests. */
export const allCommands = () => ALL_COMMANDS.map((c) => c.name);

/**
 * Actually put the commands in front of Discord.
 *
 * Discord keeps its own list of a bot's commands, separate from the code that
 * handles them. Nothing calls the API on its own, so until this runs the
 * commands exist in the source and nowhere else - which is why a new command
 * needs this to show up in anyone's palette.
 *
 * Registering is idempotent: this REPLACES the whole list, so running it again
 * is safe, and is how a command gets removed. That is why it belongs in the
 * startup command rather than being a one-time manual step - a restart after a
 * code change picks the new set up by itself.
 *
 * Guild commands appear instantly. Global ones can take up to an hour to
 * propagate, so a guild id is preferred when there is one.
 */
export async function registerCommands({ force = false } = {}) {
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
    throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in .env");
  }

  // The builders already called .toJSON() when the list was built, so each
  // entry is already a plain object ready for the API.
  const body = enabledCommands();

  // Skip the API call when nothing has changed. Discord rate-limits command
  // registration, and a server that restarts on a timer would otherwise burn
  // that budget for nothing. The fingerprint is the command list itself, so
  // editing a description or adding a command still triggers a deploy.
  const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  if (!force) {
    const previous = await readJson(STATE_FILE, null);
    if (previous?.fingerprint === fingerprint) {
      console.log(`Commands unchanged (${body.length}), skipping registration.`);
      return { scope: "skipped", count: body.length };
    }
  }

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  // Register to the main guild as well as globally, when there is one.
  //
  // Global registration is what puts the commands in every server the bot is
  // in, but Discord can take up to an hour to propagate it. A guild
  // registration shows up instantly in that one server. Doing both means the
  // commands are usable in your server right away and everywhere else
  // eventually, which matters when the bot is a user install.
  const guildIds = [...new Set([DISCORD_GUILD_ID, process.env.MAIN_GUILD_ID].filter(Boolean))];
  const done = [];

  for (const guildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, guildId), { body });
    done.push(`guild ${guildId}`);
  }

  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body });
  done.push("globally");

  await writeJson(STATE_FILE, {
    fingerprint,
    scope: done.join(", "),
    at: new Date().toISOString(),
  });

  console.log(`Registered ${body.length} command(s): ${done.join(", ")}.`);
  return { scope: done.join(", "), count: body.length };
}

// Run when executed directly (`npm run deploy`), not when imported.
if (isMainModule()) {
  try {
    await registerCommands();
  } catch (err) {
    // A failed register must never stop the bot from starting: the typed
    // commands all work without it, and a transient Discord outage at boot
    // shouldn't take the whole server down.
    console.error("Could not register the slash commands:", err?.message ?? err);
    process.exitCode = 1;
  }
}
