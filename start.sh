#!/bin/bash
#
# The bot's startup script.
#
# The hosting panel's "start command" field is a short one-liner:
#
#     bash /home/container/start.sh
#
# Everything else lives here, in a file, because a long one-liner pasted into
# a web form gets truncated - and a truncated startup command fails in the
# worst way: quietly. The part that gets cut is usually the npm install, so
# the bot starts with no dependencies and dies with a missing-package error
# that looks nothing like the cause.
#
# Every step is written to fail soft where failing is survivable:
#
#   - npm install failing is fatal, because nothing works without the
#     dependencies.
#   - Registering the slash commands failing is NOT fatal. The typed commands
#     all work without them, so a Discord hiccup at boot must not stop the
#     bot from starting.
#   - The bot runs in the foreground, because the panel stops the server by
#     sending a signal to the process it started.

# Self-heal the line endings before anything else runs.
#
# A .sh file with Windows line endings is broken on Linux: bash reads
# "set -u\r" as an invalid option and "cd /home/container\r" as a directory
# that doesn't exist, so the script dies on its first line and the error
# points at the wrong thing entirely. The file is normally LF (the repo
# enforces it), but if it arrives with CRLF - from a Windows checkout, a drag
# and drop, or an editor that "helpfully" adds them - this fixes it and
# carries on.
#
# It re-runs a clean COPY rather than rewriting this file in place: bash is
# partway through reading the script, and editing the file under it would
# leave its read offset pointing at the wrong place.
#
# The CR is detected by stripping it and comparing, because grep cannot be
# relied on to match a carriage return: "grep $'\r'" silently matches
# nothing on some builds, which would make this check a no-op and the failure
# look like it had never been tried.
if tr -d '\r' < "$0" 2>/dev/null | cmp -s - "$0" 2>/dev/null; then
  # The copy is identical to the original, so there was no CR to remove.
  :
else
  echo "Fixing Windows line endings in start.sh..."
  CLEAN="/tmp/.start.sh.$$"
  if sed 's/\r$//' "$0" > "$CLEAN" 2>/dev/null; then
    chmod +x "$CLEAN" 2>/dev/null || true
    exec bash "$CLEAN" "$@"
  fi
  echo "Could not fix the line endings. Trying anyway..."
fi

set -u

# Where the app lives. The host runs it in /home/container, but this can be
# overridden so the script can be tested anywhere.
APP_DIR="${APP_DIR:-/home/container}"
NODE="${NODE:-/usr/local/bin/node}"
NPM="${NPM:-/usr/local/bin/npm}"

cd "$APP_DIR" || exit 1

echo "Starting meetbot in $APP_DIR"

# Dependencies. Without these nothing runs - dotenv, discord.js and
# google-auth-library all come from here.
if [ -f "$APP_DIR/package.json" ]; then
  echo "Installing dependencies..."
  if ! "$NPM" install --no-audit --no-fund; then
    echo "FATAL: npm install failed - the bot cannot start without its dependencies."
    exit 1
  fi
fi

# Register the slash commands with Discord. This replaces Discord's whole
# list, so a command switched off in config.json is removed from Discord too.
# It only calls Discord when the command list has actually changed, so a
# server that restarts often doesn't burn the rate limit.
if [ -f "$APP_DIR/src/deploy-commands.js" ]; then
  echo "Registering slash commands..."
  if ! "$NODE" "$APP_DIR/src/deploy-commands.js"; then
    echo "Warning: slash commands could not be registered. The typed commands still work."
  fi
fi

echo "Starting the bot..."
# exec replaces this shell with node, so the signal the panel sends to stop
# the server reaches the bot directly instead of being swallowed by bash.
exec "$NODE" "$APP_DIR/index.js"
