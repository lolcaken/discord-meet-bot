import "dotenv/config";
import {
  REST,
  Routes,
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} from "discord.js";

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

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

const commands = [
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
];
