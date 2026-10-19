// The host's start command is `node index.js`, but the bot's entry point is
// src/index.js. This keeps the platform's default working.
//
// The .env is loaded from THIS file's folder, not from the working
// directory. A panel that starts the app from somewhere else - or runs a
// git pull that changes the checkout - would otherwise leave the bot without
// its credentials and fail with a confusing "missing token" error instead of
// a clear one. dotenv/config reads process.cwd(), which is not guaranteed to
// be the app folder.
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadEnv({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env") });

await import("./src/index.js");
