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

Slash commands work anywhere — servers, DMs, group chats. In servers you can also just
type them, no slash needed.

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
answers `403 PERMISSION_DENIED`, so swapping in links from elsewhere silently breaks
the count.

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
