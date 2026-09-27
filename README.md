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
| — | `/meet` | A brand new link, plus an `@everyone` ping |
| — | `/schedule minutes:30 title:"Standup"` | Posts a fresh link later, up to 7 days out |
| — | `/end` | Ends the live call, dropping everyone still in it |

> **`meet` and `/meet` are deliberately different.** Typing `meet` gives a permanent
> standing room that always exists. `/meet` always mints a brand new link. There is no
> `/meet1` — the standing rooms are type-only so they don't clutter the command palette.

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
costs exactly one space against Google's create quota, not four. They're remembered in
`data/guildRooms.json`. If a mint fails — a rate limit, say — the bot posts a pooled link
instead so nobody is left without a way in.

The main guild's four codes are never regenerated, so they stay exactly as configured in
`src/preloadedMeets.js`.

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

The webhook is fired without being awaited, so a slow Discord never delays a reply, and
a rate-limited webhook is dropped with one console line rather than retried.

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

### Optional config

| Variable | Default | Notes |
| --- | --- | --- |
| `MEETING_POOL_SIZE` | `5` | Links pre-created in the background, so replies are instant |
| `DISCORD_GUILD_ID` | empty | Set while developing for instant command registration, clear for global |
| `DISCORD_LOG_WEBHOOK_URL` | empty | Logs every meeting created, and by whom |

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
