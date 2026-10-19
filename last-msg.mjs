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

say("--- `last` is a meet post plus one quiet label line ---");
const meetPostSrc = /const meetPost = \(uri, label\) => \(\{[\s\S]*?\n\}\);/.exec(src)[0];
// Build the payload by running the real meetPost source.
const evalMeetPost = (uri, label) =>
  new Function("uri", "label", `${meetPostSrc}\nreturn meetPost(uri, label);`)(uri, label);

const label = /const LATEST_LABEL = "([^"]+)"/.exec(src)[1];
const plain = evalMeetPost("https://meet.google.com/abc-defg-hij");
const tagged = evalMeetPost("https://meet.google.com/abc-defg-hij", label);

say("\n  meet (unchanged):\n" + plain.content.split("\n").map((l) => "  | " + l).join("\n"));
say("\n  last:\n" + tagged.content.split("\n").map((l) => "  | " + l).join("\n") + "\n");

check("the label is the latest word", label, "- latest -");
check("plain meet is byte-identical to before",
  plain.content, "@everyone join meet!!\nhttps://meet.google.com/abc-defg-hij");
check("last keeps the classic first line",
  tagged.content.split("\n")[0], "@everyone join meet!!");
check("last keeps the bare link",
  tagged.content.endsWith("https://meet.google.com/abc-defg-hij"), true);
check("the label sits directly above the link",
  tagged.content.split("\n").slice(-2, -1)[0], label);
check("last is exactly three lines before the counter",
  tagged.content.split("\n").length, 3);
check("pings everyone", JSON.stringify(tagged.allowedMentions), '{"parse":["everyone"]}');

say("\n--- no emoji in the label ---");
const glyph = /\p{Extended_Pictographic}/u;
check("the label is plain text", glyph.test(label), false);
check("no emoji anywhere in the last post", glyph.test(tagged.content), false);
check("the counter emoji still exists for the watcher",
  /const COUNTER_EMOJI = "\\u\{1F464\}"/.test(src), true);

say("\n--- the counter is live, added by the shared watcher ---");
const handler = /async function handleLast\(interaction\) \{[\s\S]*?\n\}/.exec(src)[0];
check("hands the message to watchParticipants", /watchParticipants\(message, entry\.name\)/.test(handler), true);
check("posts via meetPost with the label",
  /safeReply\(interaction, meetPost\(entry\.uri \?\? space\.meetingUri, LATEST_LABEL\)\)/.test(handler), true);
check("the label is passed as a constant", handler.includes("LATEST_LABEL"), true);
check("counts with the same call meet uses", handler.includes("{ activeOnly: true }"), true);
check("count still gates the scan", handler.includes("if (count === 0) continue"), true);

say("\n--- scan behaviour ---");
check("servers only", handler.includes("if (!interaction.guildId) return"), true);
check("never mints a space", handler.includes("createOpenMeetSpace") === false, true);
check("skips spaces with no conference", handler.includes("if (!space?.activeConference) continue"), true);
check("skips unreadable spaces", handler.includes("unreadable++"), true);
check("stops at the first one with people", /if \(count === 0\) continue;[\s\S]*?await safeReply/.test(handler), true);
check("scans every meeting in the server", handler.includes("await allSpaces(scope)"), true);
check("no scan limit remains", /LAST_SCAN_LIMIT/.test(src), false);
check("no channel preference remains", /recentSpaces/.test(src), false);
check("shares the 5s cooldown", handler.includes('cooldownRemaining("preloaded"'), true);
check("logs when it finds one", handler.includes("last.posted"), true);
check("logs when it doesn't", handler.includes("last.empty"), true);

say("\n--- empty case ---");
check('says exactly "No people active rn lol"', src.includes('"No people active rn lol"'), true);

say("\n--- the other four paths are untouched ---");
const others = src.match(/meetPost\((?!entry\.uri)[^)]*\)/g) || [];
check("four call sites pass no label", others.length, 4);
check("no emoji crept into any meet post", glyph.test(plain.content), false);

say("\n--- wired into the typed path ---");
check("parser knows the word", /"last"/.test(readFileSync("src/textCommands.js", "utf8")), true);
check("dispatched before the meet regex",
  src.indexOf('if (name === "last")') < src.indexOf("const slot = /^meet"), true);
check("returns after handling", /if \(name === "last"\) \{\s*await handleLast\(interaction\);\s*return;/.test(src), true);

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
