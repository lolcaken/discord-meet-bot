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

say("--- `last` posts exactly what `meet` posts ---");
const meetPostSrc = /const meetPost = \(uri\) => \(\{[\s\S]*?\n\}\);/.exec(src)[0];
// Build the payload by running the real meetPost source with uri bound.
const evalMeetPost = (uri) => new Function("uri", `${meetPostSrc}\nreturn meetPost(uri);`)(uri);

check("lastPost helper is gone", /const lastPost\b/.test(src), false);
check("no 'latest:' line any more", /content: "@everyone join meet!!\\nlatest:/.test(src), false);

const built = evalMeetPost("https://meet.google.com/abc-defg-hij");
say("\n  base post:\n" + built.content.split("\n").map((l) => "  | " + l).join("\n"));

check("identical to a meet post", built.content, "@everyone join meet!!\nhttps://meet.google.com/abc-defg-hij");
check("pings everyone", JSON.stringify(built.allowedMentions), '{"parse":["everyone"]}');
check("no embed anywhere", /embeds/.test(src.slice(src.indexOf("async function handleLast"), src.indexOf("async function handleLast") + 4000)), false);

say("\n--- the counter is now live, added by the shared watcher ---");
const handler = /async function handleLast\(interaction\) \{[\s\S]*?\n\}/.exec(src)[0];
check("hands the message to watchParticipants", /watchParticipants\(message, entry\.name\)/.test(handler), true);
check("posts via meetPost", /safeReply\(interaction, meetPost\(/.test(handler), true);
check("counts with the same call meet uses", handler.includes("{ activeOnly: true }"), true);
check("the watcher re-reads every poll", /setInterval/.test(src), true);
check("count still gates the scan", handler.includes("if (count === 0) continue"), true);

say("\n--- scan behaviour ---");
check("servers only", handler.includes("if (!interaction.guildId) return"), true);
check("never mints a space", handler.includes("createOpenMeetSpace") === false, true);
check("skips spaces with no conference", handler.includes("if (!space?.activeConference) continue"), true);
check("skips unreadable spaces", handler.includes("unreadable++"), true);
check("stops at the first one with people", /if \(count === 0\) continue;[\s\S]*?await safeReply/.test(handler), true);
check("scan is bounded", /const LAST_SCAN_LIMIT = (\d+);/.exec(src)[1], "5");
check("shares the 5s cooldown", handler.includes('cooldownRemaining("preloaded"'), true);
check("logs when it finds one", handler.includes("last.posted"), true);
check("logs when it doesn't", handler.includes("last.empty"), true);

say("\n--- empty case ---");
check('says exactly "No people active rn lol"', src.includes('"No people active rn lol"'), true);
check("no separate empty-candidates reply", handler.includes("candidates.length"), false);

say("\n--- wired into the typed path ---");
check("parser knows the word", readFileSync("src/textCommands.js", "utf8").includes('"meet", "rand", "last"'), true);
check("dispatched before the meet regex",
  src.indexOf('if (name === "last")') < src.indexOf("const slot = /^meet"), true);
check("returns after handling", /if \(name === "last"\) \{\s*await handleLast\(interaction\);\s*return;/.test(src), true);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
