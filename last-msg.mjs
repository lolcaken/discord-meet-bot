/**
 * The `last` command's two outcomes, built from the real source so the exact
 * strings the bot will post are checked.
 */
import { readFileSync, writeFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync("last-msg.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const src = readFileSync("src/index.js", "utf8");

say("--- the post format, lifted from the source ---");
// The source stores the escape sequence, so it has to be evaluated the way
// JavaScript would at runtime, not passed through as literal text.
const emojiLiteral = /const COUNTER_EMOJI = "([^"]+)"/.exec(src)[1];
const emoji = new Function(`return "${emojiLiteral}";`)();
const lastPost = /const lastPost = \(uri, count\) => \(\{[\s\S]*?\n\}\);/.exec(src)[0];
const evalPost = new Function(
  "COUNTER_EMOJI",
  `${lastPost}\nreturn lastPost;`
)(emoji);

const built = evalPost("https://meet.google.com/abc-defg-hij", 3);
say("\n" + built.content.split("\n").map((l) => "  | " + l).join("\n") + "\n");

check("marks it as latest", built.content.includes("latest:"), true);
check("keeps the classic meet wording", built.content.startsWith("@everyone join meet!!"), true);
check("carries the plain link", built.content.includes("https://meet.google.com/abc-defg-hij"), true);
check("carries the headcount", built.content.includes(`${emoji} 3`), true);
check("the emoji is a real person glyph", emoji.codePointAt(0) === 0x1f464, true);
check("pings everyone", JSON.stringify(built.allowedMentions), '{"parse":["everyone"]}');
check("exactly four lines", built.content.split("\n").length, 4);

say("\n--- the empty case ---");
const emptyMsg = src.includes('"No people active rn lol"');
check('says exactly "No people active rn lol"', emptyMsg, true);
const emptyLine = (src.match(/await safeReply\(interaction, ("No people active rn lol")\)/g) || []).length;
check("used for both empty paths", emptyLine, 2);

say("\n--- scan behaviour ---");
const handler = /async function handleLast\(interaction\) \{[\s\S]*?\n\}/.exec(src)[0];
check("servers only", handler.includes("if (!interaction.guildId) return"), true);
check("never mints a space", handler.includes("createOpenMeetSpace") === false, true);
check("skips spaces with no conference", handler.includes("if (!space?.activeConference) continue"), true);
check("skips unreadable spaces", handler.includes("unreadable++"), true);
check("skips a space with nobody in it", handler.includes("if (count === 0) continue"), true);
check("stops at the first one with people", /if \(count === 0\) continue;[\s\S]*?await safeReply/.test(handler), true);
check("scan is bounded", /const LAST_SCAN_LIMIT = (\d+);/.exec(src)[1], "5");
check("shares the 5s cooldown", handler.includes('cooldownRemaining("preloaded"'), true);
check("logs when it finds one", handler.includes("last.posted"), true);
check("logs when it doesn't", handler.includes("last.empty"), true);

say("\n--- one-shot, not watched ---");
check("no watch started", handler.includes("watchParticipants"), false);
check("count is baked into the message", handler.includes("lastPost("), true);

say("\n--- wired into the typed path ---");
check("parser knows the word", readFileSync("src/textCommands.js", "utf8").includes('"meet", "rand", "last"'), true);
check("dispatched before the meet regex",
  src.indexOf('if (name === "last")') < src.indexOf("const slot = /^meet"), true);
check("returns after handling", /if \(name === "last"\) \{\s*await handleLast\(interaction\);\s*return;/.test(src), true);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
