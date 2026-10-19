import { PermissionsBitField, REST, Routes } from "discord.js";
import { isOwner } from "./owner.js";
import { logEvent } from "./logger.js";

/**
 * /giverole - hand a role to a person.
 *
 * The mechanics are Discord's, not ours: the bot can only assign roles below
 * its own highest role, and only to members who don't outrank it. When that
 * bites, Discord answers 50013 and the job is to explain it in words the user
 * can act on rather than passing the error through.
 *
 * Who may run it: the bot's owner, or anyone in that server with Manage Roles.
 * The second case is not a privilege the command grants - someone with Manage
 * Roles can already assign roles through Discord's own interface - so it adds
 * nothing. The first case is a bypass, because the owner may hold a role that
 * isn't Manage Roles but still wants to use their own bot.
 */

/** The role that can never be assigned: it is the guild itself. */
const EVERYONE_ID = null;

/**
 * Can this person run the command in this server?
 *
 * @param interaction the interaction, slash or typed
 * @param member the GuildMember running it, if known
 */
export function canGiveRoles(interaction, member) {
  // The owner can always, in any server the bot is in.
  if (isOwner(interaction.user?.id)) return { allowed: true, why: "owner" };

  const perms = member?.permissions;
  if (perms?.has(PermissionsBitField.Flags.Administrator)) {
    return { allowed: true, why: "administrator" };
  }
  if (perms?.has(PermissionsBitField.Flags.ManageRoles)) {
    return { allowed: true, why: "manage-roles" };
  }
  return {
    allowed: false,
    why: "You need the Manage Roles permission in this server to give roles.",
  };
}

/**
 * Finds a role by name, case-insensitively.
 *
 * @returns the role, or null
 */
export function findRoleByName(guild, name) {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) return null;

  for (const role of guild.roles.cache.values()) {
    // @everyone is the guild itself and can never be handed to anyone.
    if (role.id === guild.id) continue;
    // Managed roles come from integrations and can't be assigned.
    if (role.managed) continue;
    if (role.name.toLowerCase() === wanted) return role;
  }
  return null;
}

/** Roles that could sensibly be assigned, for a picker or a hint. */
export function assignableRoles(guild, botMember) {
  const botHighest = botMember?.roles?.highest?.position ?? Infinity;
  // guild.roles.cache is a Collection in discord.js and a plain Map in a
  // hand-made object, so it is turned into an array either way.
  const all = Array.isArray(guild.roles.cache)
    ? guild.roles.cache
    : [...(guild.roles.cache?.values?.() ?? [])];

  return all
    .filter((role) => role.id !== guild.id && !role.managed)
    .filter((role) => role.position < botHighest)
    .sort((a, b) => b.position - a.position)
    .map((role) => role.name);
}

/**
 * Why the bot can't do this, or null if it can.
 *
 * Discord's own rules, checked up front so the user gets a sentence they can
 * act on instead of an HTTP status.
 */
export function hierarchyProblem({ botMember, targetMember, role }) {
  if (!botMember) return "I can't work out my own role in this server.";

  const botHighest = botMember.roles?.highest;
  if (!botHighest) return "I can't work out my own role in this server.";

  if (!botMember.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    return "I don't have the Manage Roles permission in this server. In Server Settings → Roles, pick my role (`hadi`), turn on Manage Roles, and drag it above the roles you want to hand out.";
  }

  // The bot cannot hand out a role that sits at or above its own.
  if (role.position >= botHighest.position) {
    return `I can't give out **${role.name}** - it sits at or above my own role. Move my role above it, or pick a lower one.`;
  }

  // Nor can it touch someone who outranks it.
  const targetHighest = targetMember?.roles?.highest;
  if (targetHighest && targetHighest.position >= botHighest.position) {
    return `I can't give **${targetMember.user?.username ?? "that person"}** a role - they outrank me. Move my role above theirs first.`;
  }

  return null;
}

/**
 * Adds a role to a member.
 *
 * Goes through the REST route directly rather than member.roles.add, because
 * the latter needs the member object and a member who isn't in the cache
 * can't be fetched without the privileged Guild Members intent. This way it
 * works for anyone in the server.
 */
async function assignRole(client, guild, userId, role, reason) {
  const rest = new REST({ version: "10" }).setToken(client.token);
  await rest.put(Routes.guildMemberRole(guild.id, userId, role.id), { body: { reason } });
}

/**
 * Answers, whichever way this interaction is already spoken for.
 *
 * The slash path defers first - creating a role and checking the hierarchy
 * can outlast Discord's 3-second deadline - so the answer is an edit of the
 * placeholder. The typed path replies outright.
 */
async function answer(interaction, content, { ephemeral = true } = {}) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply?.({ content });
  } else {
    await interaction.reply?.({ content, ephemeral });
  }
}

/**
 * The command.
 *
 * @param options.userId who gets the role
 * @param options.roleName the role to give, created if it doesn't exist
 * @param options.admin give a newly created role Administrator
 */
export async function handleGiveRole(interaction, { userId, roleName, admin = false }) {
  const guild = interaction.guild;
  if (!guild) {
    await answer(interaction, "This only works in a server.");
    return;
  }

  const member = interaction.member ?? null;
  const allowed = canGiveRoles(interaction, member);
  if (!allowed.allowed) {
    await logEvent("warn", "command.denied", {
      guildId: guild.id,
      user: interaction.user?.username,
      command: "giverole",
      reason: allowed.why,
    });
    await answer(interaction, allowed.why);
    return;
  }

  // The bot's own member object, for the hierarchy check.
  const botMember = await guild.members.me?.().catch(() => null);

  // The person receiving the role. Not fatal if we can't get them: the REST
  // call works on the id alone, and the name is only for the reply.
  const targetMember =
    guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));

  if (!targetMember) {
    await answer(interaction, `I couldn't find that person in this server. Are they still a member?`);
    return;
  }

  // Find the role, or create it.
  let role = findRoleByName(guild, roleName);
  let created = false;

  if (!role) {
    const createdRole = await guild.roles
      .create({
        name: String(roleName).trim(),
        permissions: admin ? [PermissionsBitField.Flags.Administrator] : [],
        reason: `Created by ${interaction.user?.username ?? "the bot owner"} for /giverole`,
      })
      .catch((err) => {
        if (err?.code === 50013) {
          return { failed: "I don't have permission to create roles in this server." };
        }
        return { failed: "I couldn't create that role." };
      });

    if (createdRole?.failed) {
      await answer(interaction, createdRole.failed);
      return;
    }
    role = createdRole;
    created = true;
  }

  // Check the hierarchy before trying, so the explanation is actionable.
  const problem = hierarchyProblem({ botMember, targetMember, role });
  if (problem) {
    await logEvent("warn", "command.denied", {
      guildId: guild.id,
      user: interaction.user?.username,
      command: "giverole",
      reason: problem,
    });
    await answer(interaction, problem);
    return;
  }

  try {
    await assignRole(interaction.client, guild, userId, role, `Given by ${interaction.user?.username ?? "the bot owner"}`);
  } catch (err) {
    // Discord's own hierarchy refusal. Discord.js wraps the body in an
    // AggregateError sometimes, so look in both places.
    const body = err?.body ?? err?.errors?.[0] ?? err?.cause?.body ?? err?.response?.data;
    const code = body?.code ?? err?.code;
    const message = body?.message ?? err?.message ?? "";

    if (code === 50013 || /Missing Permissions/i.test(message)) {
      await answer(interaction, `I couldn't give **${role.name}** to **${targetMember.user?.username}**. I need the Manage Roles permission, my role has to be above theirs, and I can't hand out a role that sits above my own.`);
      return;
    }

    await logEvent("error", "command.failed", {
      guildId: guild.id,
      user: interaction.user?.username,
      command: "giverole",
      reason: String(message).slice(0, 300),
    });
    await answer(interaction, `Something went wrong giving that role. Check the bot's logs.`);
    return;
  }

  const verb = created ? "Created and gave" : "Gave";
  await logEvent("info", "role.given", {
    guildId: guild.id,
    user: interaction.user?.username,
    command: "giverole",
    roleName: role.name,
    targetUser: targetMember.user?.username ?? userId,
    created,
    summary: `${verb} ${role.name} to ${targetMember.user?.username ?? userId}.`,
  });

  await answer(interaction, `${verb} **${role.name}** to **${targetMember.user?.username ?? "that person"}**.`, { ephemeral: false });
}
