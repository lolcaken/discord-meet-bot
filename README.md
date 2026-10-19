<div align="center">

<img src="logo.svg" width="112" height="112" alt="meetbot logo">

# meetbot

**A Google Meet link, one command away.**

Type `meet` in any Discord server and everyone gets in. No plugin, no waiting room, no
"can you hear me?" — the link is open to anyone who has it.

[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.js.org)
[![node](https://img.shields.io/badge/node-%3E%3D18-5FA04E?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![meet api](https://img.shields.io/badge/Google%20Meet%20API-v2-00897B?style=flat-square&logo=google&logoColor=white)](https://developers.google.com/workspace/meet/api)

</div>

---

## Project layout

```
discord-meet-bot/
├── index.js              the entry point your host runs
├── start.sh              what the host's start command calls
├── config.json           the on/off switches (committed, no secrets)
├── package.json
├── src/
│   ├── index.js          the bot itself: commands, events, startup
│   ├── config.js         reads config.json, forgivingly
│   ├── googleMeet.js     the Google Meet API calls
│   ├── meetingPool.js    pre-created links, so replies are instant
│   ├── guildRooms.js     the per-server standing rooms
│   ├── spaceRegistry.js  which meetings were handed out, where
│   ├── scheduleStore.js  pending /schedule entries
│   ├── scopeInfo.js      who each data folder belongs to
│   ├── scopeReports.js   the per-server reports
│   ├── inventory.js      which servers the bot is in
│   ├── globalMeetings.js the global roster and live meetings
│   ├── owner.js          who the owner is, and the refusal message
│   ├── logger.js         the file log and the webhook
│   ├── webhookQueue.js   the webhook queue that never drops a line
│   ├── textCommands.js   the typed words
│   ├── deploy-commands.js  registers the slash commands with Discord
│   ├── dataPaths.js      where everything on disk lives
│   ├── retry.js          retries the things worth retrying
│   ├── preloadedMeets.js the main server's starting rooms
│   └── getToken.js       the one-time Google sign-in
├── tests/                every suite, plus a runner
├── scripts/              developer tools, not part of the bot
├── data/                 runtime state (created on first run, not committed)
└── logs/                 the log files (not committed)
```

`npm test` runs every suite. `npm run config` shows the settings the bot is running with.

## What it does

```text
@everyone join meet!!
https://meet.google.com/abc-defg-hij
👤 3
```

That's the whole message. The `👤` count is live — it rises and falls as people join
and leave, and drops back to `0` when the room empties.

<div align="center">
  <img src="https://cdn.discordapp.com/embed/avatars/0.png" width="0" height="0" alt="">
</div>

## The commands

Slash commands work anywhere — servers, DMs, group chats. You can also just type the
short ones with no slash, in servers **and in DMs**. `meet` and `meet2`–`meet4` post a
standing room where one exists; in a DM there are no rooms, so you get a fresh link
instead.

| Type this | Or use | What happens |
| --- | --- | --- |
| `cd` or `meet` | — | The default standing room |
| `meet2` `meet3` `meet4` | — | The other standing rooms |
| `rand` | `/rand` | A brand new link from the pool |
| `last` | — | Re-posts the latest meeting that has people in it |
| `servers` | `/servers` | Lists every server the bot is in |
| `roster` | `/roster` | Who has used the bot here (owner only) |
| `globalroster` | `/globalroster` | Who has used the bot, everywhere (owner only) |
| `globallast` | `/globallast` | Live meetings across every server (owner only) |
| — | `/meet` | A brand new link, plus an `@everyone` ping |
| — | `/schedule minutes:30 title:"Standup"` | Posts a fresh link later, up to 7 days out |
| — | `/end` | Ends the live call, dropping everyone still in it |

> **`meet` and `/meet` are deliberately different.** Typing `meet` gives a permanent
> standing room that always exists. `/meet` always mints a brand new link. There is no
> `/meet1` — the standing rooms are type-only so they don't clutter the command palette.

### `last`

Type `last` in a server and it finds the most recent meeting that actually has people in
it, then posts it — the same `@everyone` ping and link as a `meet` post, with one quiet
`- latest -` line above the link to show it's a repost, and the same live `👤` headcount
underneath that keeps ticking.

It checks **every** meeting the bot has handed out in that server, newest first — not
just the recent ones, and not just the channel you typed in. A second `/meet` that
nobody joined, or a call posted in another channel of the same server, no longer hides
the one people are actually sitting in. If nobody's in any meeting, it says so.

`last` is **servers only** (there's no server to search in a DM) and **type-only**
(no `/last`).

### `roster`, `globalroster`, `globallast` — the owner's commands

Three commands that see everything the bot can see, so they're the owner's alone. Anyone
else who asks gets one line naming who to ask, and the owner is mentioned once so the
refusal isn't a dead end:

```
this command only avalible to daddy moath <@970921305899687967>
```

| Command | What it shows |
| --- | --- |
| `roster` | Who has used the bot in this server, and how many meetings each asked for |
| `globalroster` | The same, across every server the bot is in |
| `globallast` | Every live meeting, across every server the bot is in, with who and how many |

Discord hides all three from other people entirely (`setDefaultMemberPermissions(0)`),
so they don't even appear in anyone's command palette — but the bot still checks, because
plain text reaches the same handler.

The roster is built from the bot's own record of who asked for each meeting, not
Discord's member list, which the bot can't read without a privileged intent. Servers
are listed busiest first, so the order doesn't shuffle between runs.

### `servers` — where is the bot?

`servers` (or `/servers`) answers "which servers is this bot actually in?" — the name,
the id, the member count, whether it's the main server, and how many standing rooms it
has. It rebuilds the answer from Discord each time rather than trusting a stored list,
so it stays correct even if the files on disk are lost.

Main server only. The reply names every server the bot sits in, which isn't something
to hand to a member of any random server, so `/servers` is guild-only and won't install
into DMs.

Every boot also writes `data/guilds.json` with the same information and re-creates any
missing per-server folder, seeding the main server's four standing rooms back from
source. Room codes you edited by hand are never overwritten. Joining or leaving a server
updates both the file and the log immediately, so `guild.joined` and `guild.left` in
`logs/activity.log` tell you the moment it happens.

### Live participant count

Every command that posts a link also watches its space and edits the message with a
live headcount — the standing rooms included. That works because Meet exposes each
participant's `latest_end_time`, and a null value means "hasn't left yet" — so the
count is re-read every 15 seconds rather than latched on the first person to arrive.

The standing rooms are created through this project's own OAuth token, which is what
makes them readable: **the Meet API scopes space access per Google Cloud project, not
per person.** A space made in the same Gmail account but by a different project still
answers `403 PERMISSION_DENIED`, so links copied in from elsewhere silently break the
count.

## Multiple servers

`MAIN_GUILD_ID` in `.env` marks your own server. It gets the fixed standing rooms
and the commands reserved for it. Every other server gets **its own** standing rooms,
minted from the same Google account the first time that room is used — so the Meet API
can read them and the live 👤 count works there too.

| | Main guild | Other servers | DM |
| --- | --- | --- | --- |
| `/meet`, `/rand`, typed `rand` | yes | yes | yes |
| typed `meet`, `meet2`–`meet4` | fixed rooms | its own generated rooms | fresh link (no rooms in a DM) |
| `/schedule` | yes | yes | no |
| `/end` | yes | **no** | no |

Rooms are created one at a time, on demand: a server that only ever types `meet`
costs exactly one space against Google's create quota, not four. If a mint fails — a
rate limit, say — the bot posts a pooled link instead so nobody is left without a way
in.

### Changing a standing room

`data/guilds/<guildId>/rooms.json` is the source of truth for every server's rooms,
main guild included:

```json
{
  "1": "ggv-nove-xkr",
  "2": "dbp-ttaz-vuc",
  "3": "wqw-ajqo-cnt",
  "4": "fxf-ixhq-ucm"
}
```

Slot `1` is what a typed `meet` (or `cd`) posts; `2`–`4` are `meet2`–`meet4`. **Edit the
file and it takes effect on the next command — no redeploy and no restart**, because
the bot reads it rather than caching a copy.

The main guild's file is seeded from `src/preloadedMeets.js` on boot so it starts with
those four codes, but **only for slots that aren't already set** — anything you change
by hand survives restarts. Other servers have no seed: their slots are minted on first
use and written to the same file, so you can swap them afterwards too. A deleted slot
falls back to the seeded code, and a corrupt file is treated as "nothing set" rather
than handing back nonsense.

Slash commands still *appear* in every server, because Discord has no per-guild command
visibility. Reserved ones answer with a short refusal instead.

## Where its data lives

One folder per server, JSON files inside, all under `data/` (gitignored):

```
data/guilds/<guildId>/server.json          who this server is
data/guilds/<guildId>/rooms.json           standing rooms for that server
data/guilds/<guildId>/spaces.json          meetings it handed out there
data/guilds/<guildId>/schedules.json       pending /schedule entries
data/guilds/<guildId>/stats.json           totals, by-day counts, first/last meeting
data/guilds/<guildId>/schedules-report.json  what's pending and what's next
data/dms/<userId>/user.json                who the DM belongs to
```

`server.json` exists because a folder named `1550540829112795187` tells you nothing —
it records the name, member count, owner, join date, boost tier and icon, so reading a
folder off a VPS tells you whose it is. It's refreshed at boot, every six hours, and the
moment the bot joins a server. DM folders get the same treatment on first use.

`stats.json` and `schedules-report.json` are **derived** — computed from the files
already there, never estimated. A counter that can't be read back reports `null` rather
than a plausible-looking number, so you can trust what's in them.

Scoping per server isn't cosmetic. With one shared file, `/end` in a server could drop
a call that had been started in a completely different one — it only ever matched on
channel, and a DM and a server with the same channel name were indistinguishable.

Folder names come from Discord's numeric snowflake, and anything that isn't one is
rejected before it reaches the filesystem. Files are written to a temporary name and
renamed into place, so a crash mid-write can't truncate a record, and a file that is
corrupt anyway reads back as empty instead of taking the bot down.

The old flat `data/*.json` files are migrated on first boot, and renamed to
`*.migrated` rather than deleted. Spaces that predate this layout carry no guild id, so
they land in the main guild's folder.

## Logging

Every command is recorded to `logs/activity.log` as one JSON object per line, and to a
Discord webhook if `DISCORD_LOG_WEBHOOK_URL` is set. Events are named so they can be
grepped:

| Event | Level | Means |
| --- | --- | --- |
| `bot.ready` | info | boot: pool size, pending schedules, main guild |
| `command.received` | info | anything invoked, typed or slash |
| `meet.created` | info | a new space was minted |
| `room.posted` | info | a standing room was shared |
| `room.generated` | info | a new server got one of its own rooms |
| `schedule.created` | info | a meeting was scheduled |
| `conference.ended` | info | `/end` dropped a live call |
| `request.throttled` | warn | a cooldown refused a request |
| `command.denied` | warn | reserved command, or nothing to end |
| `command.failed` | error | something broke, with the reason |

`DISCORD_ERROR_WEBHOOK_URL` optionally routes only errors somewhere separate, so
failures aren't buried in routine activity. The file rotates at 1 MB, keeping three
generations — without that it would grow until the disk filled.

Errors also land in `logs/errorlog.json` as a single JSON array, newest first, so
`jq` or any dashboard can read them without parsing a log format. It's capped at the
most recent 200, because it's rewritten whole on each error.

The webhook is fed through a single serialised queue, so a slow Discord never delays a
reply but nothing is lost either. Posts are paced just under Discord's 30/minute ceiling,
and if one is rate-limited anyway the whole queue pauses for exactly as long as Discord's
`retry_after` asks and then resumes — the line is delivered, not dropped. A deleted or
unauthorised webhook (`404`/`401`/`403`) disables posting once with a single console line
instead of retrying forever; transient `5xx`/network failures back off and give up after
a few tries. The queue is capped, and on overflow the oldest entry is dropped (counted,
not silent). Tuning knobs, all optional:

| Variable | Default | What it does |
| --- | --- | --- |
| `LOG_WEBHOOK_MAX_PER_MINUTE` | `28` | Pace of outgoing posts |
| `LOG_WEBHOOK_QUEUE_MAX` | `200` | Entries held before the oldest is dropped |
| `LOG_WEBHOOK_MAX_ATTEMPTS` | `5` | Retries for a single post before giving up |

Run `node -e "import('./src/logger.js').then(m=>console.log(m.webhookStats()))"` to see
the live pending/dropped/retry counters.

## Setup

### 1. Discord

1. [Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** → **Add Bot** → copy the token.
3. **General Information** → copy the **Application ID**.
4. **OAuth2 → URL Generator** → tick `bot` and `applications.commands`, invite it.

### 2. Google

1. [Cloud Console](https://console.cloud.google.com/) → new project.
2. **APIs & Services → Library** → enable **Google Meet API**.
3. **OAuth consent screen** → External → add your own Gmail as a test user.
4. **Credentials → OAuth client ID** → *Desktop app* → copy ID and secret.

### 3. Run it

```bash
npm install
cp .env.example .env    # then fill it in
npm run auth            # one-time, opens a browser for consent
npm run deploy          # registers the slash commands
npm start
```

`npm run auth` prints a `GOOGLE_REFRESH_TOKEN=…` line — paste it into `.env`. No Google
Workspace needed; a personal Gmail account works.

### Registering the slash commands

Discord keeps its own list of a bot's commands, separate from the code that handles
them, so they have to be pushed to Discord — `npm run deploy` does that. It registers
to your main guild (instant) and globally (which can take up to an hour to propagate),
so the commands are usable straight away in your own server and everywhere else
eventually.

The deploy only calls Discord when the command list has actually changed, so running
it on every start is cheap. That makes it safe to put in the host's startup command,
which is how a pushed change becomes live on the next restart.

**Use `start.sh` rather than pasting a long command.** The startup command is then
just:

```bash
bash /home/container/start.sh
```

`start.sh` installs the dependencies, registers the slash commands, and runs the bot.
A long one-liner pasted into a web form gets truncated, and a truncated startup
command fails quietly — the part that gets cut is usually the `npm install`, so the bot
starts with no dependencies and dies with a missing-package error that looks nothing
like the cause.

Two details in `start.sh` matter:

- Registering the slash commands failing is **not** fatal. Every typed command works
  without them, so a Discord hiccup at boot must not stop the bot from starting.
- The bot is started with `exec`, so the signal your host sends to stop the server
  reaches the bot directly instead of being swallowed by the shell.

### Turning features off — `config.json`

`config.json` in the repo root is where you switch things on and off. It's committed on
purpose, so the settings travel with the code and anyone who clones the bot can see how
it's meant to run. **Secrets do not go here** — those stay in `.env`.

```json
{
  "commands":  { "meet": true, "rand": true, "last": true, "...": true },
  "features":  { "standingRooms": true, "participantCounter": true, "...": true },
  "limits":    { "cooldownSeconds": 5, "poolSize": 5, "...": 5 }
}
```

Edit it, restart, done. Run `npm run config` to see what the bot is actually running with.

| Switch | What turning it off does |
| --- | --- |
| `commands.meet` | Removes `/meet`, and stops typed `meet`/`cd`/`meet2`… working |
| `commands.rand` | Removes `/rand` and typed `rand` |
| `commands.last` | Stops typed `last` finding the meeting people are in |
| `commands.schedule` | Removes `/schedule` |
| `commands.end` | Removes `/end` |
| `commands.servers` | Removes `/servers` |
| `commands.roster` / `globalroster` / `globallast` | The owner's commands, off |
| `features.standingRooms` | The per-server fixed rooms; typed `meet` falls back to a random link |
| `features.participantCounter` | The live `👤` headcount under a meeting link |
| `features.webhookLogging` | Nothing is posted to the log webhook (the file log carries on) |
| `features.schedules` | No timers are armed; scheduled meetings never fire |
| `features.inventory` | The server inventory isn't written to `data/guilds.json` |
| `limits.cooldownSeconds` | Seconds between meeting posts in a channel |
| `limits.maxScheduleMinutes` | How far ahead `/schedule` can be set (default 7 days) |
| `limits.poolSize` | Links pre-created in the background, so replies are instant |
| `limits.logWebhook*` | How the log webhook queue paces, queues and retries |

A command that's off **isn't registered with Discord at all**, so it disappears from
everyone's command palette — and because registering replaces the whole list, turning one
off here actually removes it. Typed commands don't parse at all when they're off.

The loader is forgiving on purpose: no `config.json` means everything is on, a broken one
falls back to the defaults with a warning, and a value of the wrong type is ignored. A
typo in a switch should never stop the bot from starting.

### Environment variables

These still work and, for the limits, still win over `config.json`:

| Variable | Default | Notes |
| --- | --- | --- |
| `MEETING_POOL_SIZE` | `5` | Links pre-created in the background, so replies are instant |
| `DISCORD_GUILD_ID` | empty | Set while developing for instant command registration, clear for global |
| `DISCORD_LOG_WEBHOOK_URL` | empty | Logs every meeting created, and by whom |
| `MAIN_GUILD_ID` | empty | The server that owns the standing rooms and `/end` |

## Plain text commands

Typed commands need Discord's **Message Content** privileged intent. Without it Discord
silently sends no message content and the typed words never fire, while slash commands
keep working — which makes it look like a bug rather than a missing toggle.

**Developer Portal → your app → Bot → Privileged Gateway Intents → Message Content
Intent → on.** Then restart.

A typed command must be the *entire* message, so ordinary conversation is safe:
`lets meet tomorrow`, `i met him today` and `rand is a funny word` are all ignored.

## How it works

`spaces.create` is called with `accessType: "OPEN"`, which is Meet's own setting for
"anyone with the link joins, nobody has to knock". A small pool of these spaces is
created ahead of time and refilled in the background, so `/meet` hands one out instantly
instead of waiting on a round trip.

The Meet API enforces ownership itself — `/end` can only touch spaces created by the
account behind the OAuth token, so it can't be pointed at someone else's meeting.

## Notes

- Meetings are created under **your** Google account. Don't share the install link with
  people you don't trust, and don't post links where you don't want them found.
- If `/meet` starts failing, the OAuth token was probably revoked — re-run `npm run auth`.
- Not affiliated with Google or Discord.

## License

[MIT](LICENSE)
