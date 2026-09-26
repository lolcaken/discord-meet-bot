import { parseTextCommand } from "./src/textCommands.js";

let pass = 0;
let fail = 0;

const is = (input, want, label) => {
  const got = parseTextCommand(input);
  const gotStr = got ? JSON.stringify(got) : "null";
  const wantStr = want === null ? "null" : JSON.stringify(want);
  const ok = gotStr === wantStr;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${JSON.stringify(input)}  ${label}`);
  if (!ok) console.log(`         want ${wantStr}\n         got  ${gotStr}`);
  ok ? pass++ : fail++;
};

const cmd = (n) => ({ name: n, options: { name: n } });

console.log("--- text: must NOT fire ---");
is("lets meet tomorrow", null, "sentence containing meet");
is("i met him today", null, "met");
is("meeting at 3", null, "meeting");
is("meet me outside", null, "meet with trailing words");
is("rand is a funny word", null, "rand in a sentence");
is("the end of it", null, "sentence starting end");
is("lock the door", null, "lock is not a text command");
is("roster", null, "roster removed");
is("history", null, "history removed");
is("artifacts", null, "artifacts removed");
is("schedule 30", null, "schedule not text-triggered");
is("end", null, "end is slash-only");
is("/meet", null, "slash path");
is("/end", null, "slash path");
is("", null, "empty");
is("   ", null, "whitespace");
is(null, null, "null");
is(undefined, null, "undefined");
is(42, null, "number");

console.log("\n--- text: must fire ---");
is("meet", cmd("meet"), "bare meet -> preloaded link 1");
is("!meet", cmd("meet"), "bang prefixed");
is("MEET", cmd("meet"), "uppercase");
is("  meet  ", cmd("meet"), "padded");
is("rand", cmd("rand"), "rand -> pooled");
is("meet2", cmd("meet2"), "meet2");
is("meet3", cmd("meet3"), "meet3");
is("meet4", cmd("meet4"), "meet4");
is("meet9", cmd("meet9"), "unknown slot still parses (handler ignores)");
is("meet12", cmd("meet12"), "multi-digit slot");

console.log("\n--- text: meet1 is NOT a command (meet is slot 1) ---");
is("meet1", null, "typed meet1 does nothing");
is("meet1 is my favourite", null, "meet1 in a sentence");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
