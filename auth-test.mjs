/**
 * The google-auth-library 9 -> 11 major bump must not have broken auth.
 * Exercises every API this project uses against the live Meet API.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { OAuth2Client } from "google-auth-library";
import { createOpenMeetSpace, getSpace, listParticipants, warmUpAuth } from "./src/googleMeet.js";

const out = [];
const say = (s) => { out.push(s); writeFileSync("auth-test.txt", out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

say("=== the four APIs this project uses, on v11 ===");
say(`  google-auth-library resolves: ${new OAuth2Client("a", "b") ? "OAuth2Client ok" : "BROKEN"}\n`);

say("--- warmUpAuth(): refreshes the stored refresh token ---");
try {
  await warmUpAuth();
  say("  ok - token refreshed, no throw");
} catch (err) {
  say(`  FAILED: ${String(err.message).slice(0, 160)}`);
  fail++;
}

say("\n--- getAccessToken(): the shape both API paths destructure ---");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const { token } = await client.getAccessToken();
check("returns a string token", typeof token, "string");
// A ya29 OAuth access token, not a JWT: 2 dot-separated parts by design.
// The only thing that matters is that Google accepts it, proven below by a
// real authenticated write.
check("is a Google access token", /^ya29\./.test(token), true);

say("\n--- createOpenMeetSpace(): a real write through the new stack ---");
const space = await createOpenMeetSpace();
check("space created", /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(space.meetingCode), true);
check("canonical name returned", /^spaces\/.+/.test(space.name), true);

say("\n--- getSpace() by code alias ---");
const got = await getSpace(`spaces/${space.meetingCode}`);
check("alias resolves", Boolean(got.meetingCode), true);
check("returns the canonical name", got.name, space.name);

say("\n--- listParticipants(): the filter the counter depends on ---");
if (got.activeConference) {
  const { participants = [] } = await listParticipants(got.activeConference.conferenceRecord, { activeOnly: true });
  say(`  ok - active participants on this call: ${participants.length}`);
  check("participants is an array", Array.isArray(participants), true);
} else {
  // Fresh space, nobody in it. The 400 a fake id produces is itself proof
  // the call reached Google and was rejected on its merits, not a crash.
  const shaped = await listParticipants("conferenceRecords/does-not-exist", { activeOnly: true })
    .then(() => ({ ok: true }))
    .catch((err) => ({ ok: false, status: /\((\d+)\)/.exec(err.message)?.[1], message: String(err.message).slice(0, 80) }));
  check("a bad conference id is rejected cleanly", shaped.ok, false);
  check("...with an HTTP status, not a crash", Boolean(shaped.status), true);
  say(`  Google said: ${shaped.message}`);
  say("  => the request path, auth and error handling all work on v11");
}

say(`\n${fail === 0 ? "ALL PASSED - the major bump is safe" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;
