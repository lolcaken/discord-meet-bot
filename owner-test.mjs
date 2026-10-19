/**
 * The owner's commands and the gate that keeps them owner's-only.
 *
 * The gate is the important part: these commands expose every server the bot
 * is in and everyone who has used it, so "not the owner gets refused" has to
 * be true, not aspirational.
 */
import { writeFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync("owner-test.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
// check(label, got, want) - the same shape as the other suites, so a check
// that expects false is actually compared rather than treated as truthy.
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(50)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const { isOwner, OWNER_ID, OWNER_MENTION, OWNER_ONLY_MESSAGE } = await import("./src/owner.js");

say("=== who the owner is ===");
check("the owner id is set", OWNER_ID, "970921305899687967");
check("the mention points at them", OWNER_MENTION, `<@${OWNER_ID}>`);
check("the message names them and mentions them",
  OWNER_ONLY_MESSAGE.includes("daddy moath") && OWNER_ONLY_MESSAGE.includes(OWNER_MENTION), true);
check("the message keeps their spelling", OWNER_ONLY_MESSAGE.includes("avalible"), true);

say("\n=== the gate ===");
check("the owner passes", isOwner(OWNER_ID), true);
check("a different user does not", isOwner("123456789012345678"), false);
check("nobody does not", isOwner(undefined), false);
check("null does not", isOwner(null), false);
check("an empty string does not", isOwner(""), false);
check("a BigInt id passes", isOwner(BigInt(OWNER_ID)), true);
check("a rounded Number id is refused, not guessed",
  isOwner(Number(OWNER_ID)), false);
check("the owner's id really is above MAX_SAFE_INTEGER",
  BigInt(OWNER_ID) > BigInt(Number.MAX_SAFE_INTEGER), true);
check("a non-numeric id does not throw", isOwner("not-an-id"), false);
check("a near-miss id does not", isOwner(OWNER_ID.slice(0, -1)), false);
check("the id with a prefix does not", isOwner(`x${OWNER_ID}`), false);
check("the id with a suffix does not", isOwner(`${OWNER_ID}x`), false);
check("a different account of the same length does not", isOwner("970921305899687968"), false);

say("\n--- the text parser accepts the new words ---");
const { parseTextCommand } = await import("./src/textCommands.js");
const cmd = (n) => ({ name: n, options: { name: n } });
for (const word of ["roster", "globalroster", "globallast"]) {
  check(`${word} parses`, parseTextCommand(word), cmd(word));
  check(`${word} in a sentence does not`,
    parseTextCommand(`hey ${word} please`), null);
}
check("global roster is not confused with roster",
  parseTextCommand("global roster"), null);

say("\n--- the new words are owner-gated in the handler ---");
const src = await import("node:fs").then((fs) => fs.readFileSync("src/index.js", "utf8"));

const handler = /async function handleOwnerOnly\(interaction, kind\) \{[\s\S]*?\n\}/.exec(src)?.[0] ?? "";
check("there is an owner handler", handler.length > 0, true);
check("it checks isOwner", handler.includes("isOwner(interaction.user?.id)"), true);
check("it replies with the owner-only message", handler.includes("OWNER_ONLY_MESSAGE"), true);
check("it logs the refusal", handler.includes("command.denied"), true);
check("it refuses BEFORE doing any work",
  handler.indexOf("isOwner") < handler.indexOf("rosterEverywhere"), true);
check("roster is handled", handler.includes('kind === "globalroster"') && handler.includes('kind === "globallast"'), true);

say("\n--- all three words route to the owner handler ---");
check("typed roster", /name === "roster" \|\| name === "globalroster" \|\| name === "globallast"/.test(src), true);
check("slash roster",
  /interaction\.commandName === "roster"/.test(src) &&
  /interaction\.commandName === "globalroster"/.test(src) &&
  /interaction\.commandName === "globallast"/.test(src), true);

say("\n--- the slash commands are hidden from everyone else ---");
const deploy = await import("node:fs").then((fs) => fs.readFileSync("src/deploy-commands.js", "utf8"));
for (const name of ["roster", "globalroster", "globallast"]) {
  const block = new RegExp(`setName\\("${name}"\\)[\\s\\S]*?\\.toJSON\\(\\)`).exec(deploy)?.[0] ?? "";
  check(`${name} is permission-gated in Discord`, block.includes("setDefaultMemberPermissions(0)"), true);
  check(`${name} is guild-only`, block.includes("InteractionContextType.Guild"), true);
  check(`${name} is not user-installable`, block.includes("GuildInstall") && !block.includes("UserInstall"), true);
}

say("\n--- `last` now scans every meeting in the server ---");
check("last uses allSpaces", /const candidates = await allSpaces\(scope\)/.test(src), true);
check("there is no scan limit left", !/LAST_SCAN_LIMIT/.test(src), true);
check("no channel preference remains", !/recentSpaces/.test(src), true);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;