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

set -u

APP_DIR="/home/container"
NODE="/usr/local/bin/node"
NPM="/usr/local/bin/npm"

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
