/**
 * Typed commands must work in DMs, not just servers. These checks read the real
 * source to confirm the DM path exists and is wired.
 */
import { readFileSync, writeFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync("dm-test.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const src = readFileSync("src/index.js", "utf8");

say("--- messageCreate no longer skips DMs ---");
const handler = /client\.on\("messageCreate"[\s\S]*?\n\}\);/.exec(src);
check("handler found", Boolean(handler), true);
check("no guild guard", handler[0].includes("!message.guild"), false);
check("bot self-filter still present", handler[0].includes("message.author.bot"), true);
check("still parses then dispatches", handler[0].includes("parseTextCommand") && handler[0].includes("handleCommand"), true);

say("\n--- typed `rand` reaches its branch in a DM ---");
// rand isn't MAIN_ONLY or GUILD_ONLY, so checkAllowed lets it through.
const mainOnly = /\nconst MAIN_ONLY = new Set\(\[([^\]]*)\]\);/.exec(src)[1];
const guildOnly = /\nconst GUILD_ONLY = new Set\(\[([^\]]*)\]\);/.exec(src)[1];
const list = (m) => m.split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
say(`  MAIN_ONLY=[${mainOnly}] GUILD_ONLY=[${guildOnly}]`);
check("rand is not main-only", list(mainOnly).includes("rand"), false);
check("rand is not guild-only", list(guildOnly).includes("rand"), false);
check("rand branch exists", src.includes('interaction.commandName === "rand"'), true);
check("rand mints via the pool", /commandName === "rand"[\s\S]{0,400}takeMeetingWithCooldown/.test(src), true);

say("\n--- typed `meet` in a DM falls back to a pooled link ---");
// Slice from the text branch to the end of the DM fallback, rather than
// guessing at brace depth with a regex.
const start = src.indexOf("if (interaction.isTextCommand) {");
const end = src.indexOf('if (interaction.commandName === "meet")');
const textBranch = start !== -1 && end > start ? src.slice(start, end) : "";
check("text branch found", textBranch.length > 0, true);
check("roomCodeFor returns null with no guild",
  /async function roomCodeFor[\s\S]*?if \(!guildId\) return null/.test(src), true);
check("null code no longer returns silently", textBranch.includes("if (!code) return;"), false);
check("DM fallback mints a pooled link", textBranch.includes("const fresh = await takeMeeting()"), true);
check("DM fallback posts the link", textBranch.includes("meetPost(fresh.meetingUri)"), true);
check("DM fallback starts the live count", textBranch.includes("watchParticipants(message, fresh.name)"), true);
check("DM fallback records the space for /end", textBranch.includes("rememberSpace"), true);
check("guild path still posts a room", textBranch.includes("code = await roomCodeFor"), true);

say("\n--- permissions unchanged ---");
check("meet is not main-only", list(mainOnly).includes("meet"), false);
check("end is main-only", list(mainOnly).includes("end"), true);
check("schedule is guild-only", list(guildOnly).includes("schedule"), true);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
