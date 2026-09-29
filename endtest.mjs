/**
 * The /end identifier bug, exercised for real.
 *
 * Before the fix, /end code:ggv-nove-xkr built "spaces/ggv-nove-xkr" and
 * endActiveConference rejected it with 403. It needs the canonical name that
 * spaces.get hands back for a code alias.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getSpace, endActiveConference, createOpenMeetSpace } from "./src/googleMeet.js";

const out = [];
const say = (s) => { out.push(s); writeFileSync("endtest.txt", out.join("\n") + "\n", "utf8"); };

// Same shape as resolveSpace() in index.js.
const resolveViaCode = async (raw) => {
  const match = String(raw).toLowerCase().match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/)?.[0];
  if (!match) return null;
  try {
    const space = await getSpace(`spaces/${match}`);
    return { name: space.name, code: match };
  } catch {
    return null;
  }
};

const tryEnd = async (label, ref) => {
  try {
    await endActiveConference(ref);
    say(`  ${label.padEnd(30)} -> 204 accepted`);
    return "accepted";
  } catch (err) {
    const status = /\((\d+)\)/.exec(err.message)?.[1];
    const verdict = /no active conference/i.test(err.message)
      ? "400 accepted (no live call)"
      : /Permission denied/i.test(err.message) ? "403 REJECTED" : String(err.message).slice(0, 60);
    say(`  ${label.padEnd(30)} -> ${status} ${verdict}`);
    return status;
  }
};

say("=== 1. the preloaded room that failed, resolved by code ===");
const resolved = await resolveViaCode("ggv-nove-xkr");
if (!resolved) {
  say("  could not resolve - the code is unreadable for this host");
} else {
  say(`  code         : ${resolved.code}`);
  say(`  canonical    : ${resolved.name}   <- what the fix now passes to endActiveConference`);
  const space = await getSpace(`spaces/${resolved.code}`);
  say(`  live call?   : ${space.activeConference ? "yes" : "no"}`);

  say("\n=== 2. the old behaviour: passing the code alias straight through ===");
  await tryEnd("alias (the old bug)", `spaces/${resolved.code}`);

  say("\n=== 3. the new behaviour: the canonical name ===");
  const status = await tryEnd("canonical (the fix)", resolved.name);
  say(`\n  => ${status === "403" ? "STILL REJECTED" : "ACCEPTED - the 403 is gone"}`);
}

say("\n=== 4. a space created by this host, ended by its own code ===");
const fresh = await createOpenMeetSpace();
const r2 = await resolveViaCode(fresh.meetingCode);
say(`  canonical: ${r2?.name}`);
await tryEnd("fresh space by code", r2.name);

say("\ndone");
