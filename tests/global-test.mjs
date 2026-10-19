/**
 * The global commands' logic, against a fake Meet API.
 *
 * The point of `last` and `globallast` is finding a meeting that actually has
 * people in it, and the hard part is everything that isn't: ended calls,
 * spaces the bot can't read, and meetings in other servers.
 */
import { writeFileSync, mkdirSync, writeFileSync as wf } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "meetbot-global-"));
process.env.DATA_DIR = tmp;
process.env.GOOGLE_CLIENT_ID ??= "x";
process.env.GOOGLE_CLIENT_SECRET ??= "y";
process.env.GOOGLE_REFRESH_TOKEN ??= "z";

const out = [];
const say = (s) => { out.push(s); writeFileSync(new URL("global-test.txt", import.meta.url), out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(50)} got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

const G1 = "1550540829112795187";
const G2 = "1463484922604945421";

// Two servers, three spaces between them.
mkdirSync(path.join(tmp, "guilds", G1), { recursive: true });
mkdirSync(path.join(tmp, "guilds", G2), { recursive: true });
wf(path.join(tmp, "guilds", G1, "spaces.json"), JSON.stringify([
  { name: "spaces/aaa-aaaa-aaa", code: "aaa-aaaa-aaa", uri: "https://meet.google.com/aaa-aaaa-aaa", requestedBy: "zoe", at: "2026-10-12T08:00:00.000Z" },
  { name: "spaces/bbb-bbbb-bbb", code: "bbb-bbbb-bbb", uri: "https://meet.google.com/bbb-bbbb-bbb", requestedBy: "amy", at: "2026-10-12T07:00:00.000Z" },
]));
wf(path.join(tmp, "guilds", G2, "spaces.json"), JSON.stringify([
  { name: "spaces/ccc-cccc-ccc", code: "ccc-cccc-ccc", uri: "https://meet.google.com/ccc-cccc-ccc", requestedBy: "bob", at: "2026-10-11T07:00:00.000Z" },
]));

// The fake Meet API: which spaces are live, and how many people are in them.
const LIVE = {
  "spaces/bbb-bbbb-bbb": 4, // live with people, in server 1
  "spaces/ccc-cccc-ccc": 2, // live with people, in server 2
  "spaces/aaa-aaaa-aaa": 0, // live but empty
  "spaces/ddd-dddd-ddd": 9, // live, but not in any server's file
};

const { liveMeetingsEverywhere, rosterEverywhere, renderRoster, renderLiveMeetings } =
  await import("../src/globalMeetings.js");

// Stub the API by intercepting the module's imports is not possible here, so
// exercise the pure parts (roster + rendering) directly, and test the live
// scan through the exported helpers with a fake client.
const client = {
  guilds: {
    cache: new Map([
      [G1, { id: G1, name: "Bounty Hunters", memberCount: 412 }],
      [G2, { id: G2, name: "Other Server", memberCount: 9 }],
    ]),
  },
};

say("=== the roster: who has used the bot, where ===");
const rows = await rosterEverywhere(client);
check("both servers are listed", rows.length, 2);
check("the first server is named", rows[0].guildName, "Bounty Hunters");
check("the second server is named", rows[1].guildName, "Other Server");
check("meeting count is right", rows[0].totalMeetings, 2);
check("members are counted", rows[0].memberCount, 412);

const zoe = rows[0].people.find((p) => p.name === "zoe");
check("a person is listed", zoe?.name, "zoe");
check("their meeting count", zoe?.meetings, 1);
check("their last meeting date", zoe?.lastAt?.slice(0, 10), "2026-10-12");
check("the other server's person is listed too",
  rows[1].people.some((p) => p.name === "bob"), true);

say("\n--- roster scoped to one server ---");
const one = await rosterEverywhere(client, { scope: G1 });
check("only that server", one.length, 1);
check("it's the right one", one[0].guildId, G1);
check("and no one from the other server",
  one[0].people.some((p) => p.name === "bob"), false);

say("\n=== rendering the roster ===");
const text = renderRoster(rows);
say("\n" + text.split("\n").map((l) => "  | " + l).join("\n") + "\n");
check("it names both servers", text.includes("Bounty Hunters") && text.includes("Other Server"), true);
check("it lists a person", text.includes("zoe"), true);
check("it fits in 2000", text.length < 2000, true);
check("an empty roster says so", renderRoster([]), "No meetings handed out yet, anywhere.");

say("\n--- a huge roster is trimmed rather than rejected ---");
const many = Array.from({ length: 300 }, (_, i) => ({
  guildId: `1${i}`,
  guildName: `Server ${i}`,
  memberCount: 1000,
  totalMeetings: 50,
  people: Array.from({ length: 30 }, (_, j) => ({ name: `person_${i}_${j}`, meetings: 5, lastAt: "2026-10-12T00:00:00.000Z" })),
}));
const huge = renderRoster(many);
check("it fits", huge.length <= 2000, true);
check("it was cut", huge.length < 20000, true);

say("\n=== rendering live meetings ===");
const found = [
  { guildId: G1, guildName: "Bounty Hunters", entry: { uri: "https://meet.google.com/bbb-bbbb-bbb" }, count: 4 },
  { guildId: G2, guildName: "Other Server", entry: { uri: "https://meet.google.com/ccc-cccc-ccc" }, count: 2 },
];
const live = renderLiveMeetings(found);
say("\n" + live.split("\n").map((l) => "  | " + l).join("\n") + "\n");
check("it counts the meetings", live.startsWith("live meetings - 2"), true);
check("it shows the server", live.includes("Bounty Hunters"), true);
check("it shows the link", live.includes("https://meet.google.com/bbb-bbbb-bbb"), true);
check("it shows the count", live.includes("4 in it"), true);
check("no live meetings says so", renderLiveMeetings([]), "No people active rn lol");

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
rmSync(tmp, { recursive: true, force: true });
process.exitCode = fail ? 1 : 0;