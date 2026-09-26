import { parseTextCommand } from "./src/textCommands.js";
import { PRELOADED_MEETS } from "./src/preloadedMeets.js";
import { readFileSync, writeFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync("dispatch-test.txt", out.join("\n") + "\n", "utf8"); };

const src = readFileSync("src/index.js", "utf8");
const meetPost = /\@everyone join meet!!\\n\$\{uri\}/.test(src);

say("=== full path: message -> parse -> slot -> link ===");
say(`  meetPost present in source: ${meetPost}\n`);

for (const typed of ["meet", "meet2", "meet3", "meet4", "rand"]) {
  const parsed = parseTextCommand(typed);
  if (!parsed) { say(`  ${typed.padEnd(7)} -> not a text command`); continue; }

  const name = parsed.name;
  const slot = /^meet(?:([2-9]|[1-9][0-9]+))?$/.exec(name);
  if (slot) {
    const code = PRELOADED_MEETS[slot[1] ?? "1"];
    say(`  ${typed.padEnd(7)} -> HARDCODED  https://meet.google.com/${code}`);
  } else {
    say(`  ${typed.padEnd(7)} -> RANDOM (pooled), takeMeeting()`);
  }
}

say("\n=== the four standing rooms, as the user typed them ===");
for (const typed of ["meet", "meet2", "meet3", "meet4"]) {
  const name = parseTextCommand(typed).name;
  const slot = /^meet(?:([2-9]|[1-9][0-9]+))?$/.exec(name);
  say(`  ${typed.padEnd(7)} -> ${PRELOADED_MEETS[slot[1] ?? "1"]}`);
}

say(`\n  typed \`meet\` == tgc-rzea-btb : ${PRELOADED_MEETS["1"] === "tgc-rzea-btb"}`);
