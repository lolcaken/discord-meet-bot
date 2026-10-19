/**
 * /giverole: who may use it, and when Discord's own rules say no.
 *
 * The permission gate and the hierarchy checks are the security-relevant
 * parts, so they're tested directly rather than through a fake Discord.
 */
import { writeFileSync } from "node:fs";
import { PermissionsBitField } from "discord.js";

const out = [];
const say = (s) => { out.push(s); writeFileSync(new URL("roles-test.txt", import.meta.url), out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(50)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const { canGiveRoles, findRoleByName, hierarchyProblem, assignableRoles } = await import("../src/roles.js");
const { OWNER_ID } = await import("../src/owner.js");

// A member with a given set of permissions.
const member = (perms, id = "1") => ({
  id,
  user: { username: `user${id}` },
  permissions: { has: (flag) => perms.includes(flag) },
});

// A role in the hierarchy.
const role = (name, position, extra = {}) => ({
  name,
  position,
  id: `role-${name}-${position}`,
  managed: false,
  ...extra,
});

say("=== who may use it ===");
const ADMIN = PermissionsBitField.Flags.Administrator;
const MANAGE = PermissionsBitField.Flags.ManageRoles;

check("the owner may, anywhere", canGiveRoles({ user: { id: OWNER_ID } }, null).allowed, true);
check("the owner doesn't need a permission", canGiveRoles({ user: { id: OWNER_ID } }, null).why, "owner");
check("an admin may", canGiveRoles({ user: { id: "2" } }, member([ADMIN])).allowed, true);
check("manage-roles may", canGiveRoles({ user: { id: "3" } }, member([MANAGE])).allowed, true);
check("nobody else may", canGiveRoles({ user: { id: "4" } }, member([])).allowed, false);
check("and they're told why", canGiveRoles({ user: { id: "4" } }, member([])).allowed === false, true);
check("a missing member is refused", canGiveRoles({ user: { id: "5" } }, null).allowed, false);
// With no user id the owner check can't pass, but a member who really has
// Manage Roles is still someone who could hand out roles by hand.
check("an admin is still allowed without a user id", canGiveRoles({}, member([ADMIN])).allowed, true);
check("a plain member is still refused without a user id", canGiveRoles({}, member([])).allowed, false);
check("an id that merely looks like the owner is refused",
  canGiveRoles({ user: { id: OWNER_ID.slice(0, -1) } }, member([ADMIN])).allowed, true);

say("\n=== finding a role by name ===");
const guild = {
  id: "111111111111111111",
  roles: {
    cache: new Map([
      ["r1", role("Admin", 10)],
      ["r2", role("admin", 5)],      // same name, different case, lower position
      ["r3", role("Member", 2)],
      ["r4", role("Bot", 8, { managed: true })],
      ["r5", { name: "@everyone", position: 0, id: "111111111111111111", managed: false }],
    ]),
  },
};
check("it finds a role", findRoleByName(guild, "Admin")?.name, "Admin");
check("it ignores case", findRoleByName(guild, "aDmIn")?.name, "Admin");
check("it finds a different role", findRoleByName(guild, "Member")?.name, "Member");
check("a missing role is null", findRoleByName(guild, "Nope"), null);
check("an empty name is null", findRoleByName(guild, ""), null);
check("@everyone is never assignable", findRoleByName(guild, "@everyone"), null);
check("a managed role is never assignable", findRoleByName(guild, "Bot"), null);

say("\n=== Discord's hierarchy rules, checked before trying ===");
const botMember = {
  id: "bot",
  permissions: { has: (f) => f === MANAGE },
  roles: { highest: role("BotTop", 10) },
};
const target = {
  user: { username: "target" },
  roles: { highest: role("Low", 3) },
};
const lowRole = role("Member", 2);
const highRole = role("Owner", 20);

check("a normal grant is allowed", hierarchyProblem({ botMember, targetMember: target, role: lowRole }), null);
check("a role above the bot is refused",
  hierarchyProblem({ botMember, targetMember: target, role: highRole })?.includes("at or above my own"), true);
check("someone who outranks the bot is refused",
  hierarchyProblem({ botMember, targetMember: { user: { username: "boss" }, roles: { highest: role("Boss", 15) } }, role: lowRole })?.includes("outrank me"), true);
check("the bot without Manage Roles is refused",
  hierarchyProblem({ botMember: { ...botMember, permissions: { has: () => false } }, targetMember: target, role: lowRole })?.includes("Manage Roles"), true);
check("a missing bot member is handled",
  hierarchyProblem({ botMember: null, targetMember: target, role: lowRole }) !== null, true);
check("the reason names the role",
  hierarchyProblem({ botMember, targetMember: target, role: highRole })?.includes("Owner"), true);

say("\n=== which roles could be given out ===");
const botMember2 = { roles: { highest: role("BotTop", 10) } };
const assignable = assignableRoles(guild, botMember2);
check("the bot's own high role is excluded", assignable.includes("BotTop"), false);
check("lower roles are listed", assignable.includes("Member"), true);
check("@everyone is excluded", assignable.includes("@everyone"), false);
check("managed roles are excluded", assignable.includes("Bot"), false);
// "Admin" sits at position 10, the same as the bot's own role, so it can't be
// handed out; "admin" at 5 can. That the two differ only by case is the point.
check("a role at the bot's own level is excluded", assignable.includes("Admin"), false);
check("the assignable one is listed", assignable.includes("admin"), true);
check("the list is ordered by position", assignable[0], "admin");

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;