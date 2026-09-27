import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "activity.log");
const ERROR_FILE = path.join(LOG_DIR, "errorlog.json");

// The log is append-only and never pruned by anything else, so without a cap
// it grows until the disk fills. Rotate on size, keeping a few generations.
const MAX_BYTES = 1024 * 1024;
const KEEP = 3;

// How many errors to keep in errorlog.json before dropping the oldest. It is
// rewritten whole on every error, so it has to stay bounded or the write gets
// slower every time.
const MAX_ERRORS = 200;

const WEBHOOK_TIMEOUT_MS = 8000;

const COLORS = { info: 0x5865f2, warn: 0xfaa61a, error: 0xed4245 };
const GLYPH = { info: "•", warn: "!", error: "x" };

let dirReady = false;

async function ensureLogDir() {
  if (dirReady) return;
  if (!existsSync(LOG_DIR)) await mkdir(LOG_DIR, { recursive: true });
  dirReady = true;
}

async function rotateIfNeeded(file) {
  if (!existsSync(file)) return;
  const { size } = await stat(file);
  if (size < MAX_BYTES) return;
  for (let i = KEEP - 1; i >= 1; i--) {
    const from = `${file}.${i}`;
    if (existsSync(from)) await rename(from, `${file}.${i + 1}`).catch(() => {});
  }
  await rename(file, `${file}.1`).catch(() => {});
}

/**
 * Errors, kept as one JSON array in a single file so tooling (jq, a dashboard,
 * `node -e`) can read them without parsing a log format. Read-modify-write, so
 * it is capped rather than allowed to grow without bound.
 */
async function writeErrorFile(level, event, data) {
  if (level !== "error") return;
  try {
    await ensureLogDir();
    let existing = [];
    try {
      const parsed = JSON.parse(await readFile(ERROR_FILE, "utf8"));
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      existing = [];
    }
    const entry = { ts: new Date().toISOString(), event, ...data };
    const next = [entry, ...existing].slice(0, MAX_ERRORS);
    const tmp = `${ERROR_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, ERROR_FILE);
  } catch (err) {
    console.error("Failed to write errorlog.json:", err.message);
  }
}

const isBlank = (v) => v === undefined || v === null || v === "";

/** Human-readable field label: userId -> "User id", guildName -> "Guild name". */
const label = (key) =>
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

const clip = (value, max = 900) => {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

async function writeToFile(level, event, data) {
  try {
    await ensureLogDir();
    await rotateIfNeeded(LOG_FILE);
    const record = { ts: new Date().toISOString(), level, event, ...data };
    await appendFile(LOG_FILE, JSON.stringify(record) + "\n", "utf8");
    await writeErrorFile(level, event, data);
  } catch (err) {
    // Never let logging take the bot down.
    console.error("Failed to write the activity log:", err.message);
  }
}

function buildEmbed(level, event, data) {
  const fields = [];
  for (const [key, value] of Object.entries(data)) {
    if (isBlank(value) || key.startsWith("_")) continue;
    const text = clip(value);
    // Backtick anything code-shaped so usernames can't inject markdown.
    const shown = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$|^\d{15,}$|^https?:/.test(text) ? `\`${text}\`` : text;
    fields.push({ name: clip(label(key), 256), value: shown, inline: text.length <= 40 });
    if (fields.length >= 20) break;
  }

  return {
    title: `${GLYPH[level] ?? "•"} ${event}`,
    description: isBlank(data.summary) ? undefined : clip(data.summary, 200),
    color: COLORS[level] ?? COLORS.info,
    fields,
    footer: { text: "meetbot" },
    timestamp: new Date().toISOString(),
  };
}

async function postToWebhook(level, event, data) {
  // Errors can be routed somewhere louder without duplicating everything.
  const url =
    level === "error" && process.env.DISCORD_ERROR_WEBHOOK_URL
      ? process.env.DISCORD_ERROR_WEBHOOK_URL
      : process.env.DISCORD_LOG_WEBHOOK_URL;
  if (!url) return;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "meetbot", embeds: [buildEmbed(level, event, data)] }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (response.ok) return;
    if (response.status === 429) {
      // Discord is rate limiting the webhook itself. Log it once and move on
      // rather than retrying, which would make it worse.
      const body = await response.text().catch(() => "");
      console.error("Webhook rate limited; dropping this log line:", body.slice(0, 120));
      return;
    }
    console.error(`Webhook log failed (${response.status}):`, await response.text().catch(() => ""));
  } catch (err) {
    console.error("Webhook log failed:", err.message);
  }
}

/**
 * The single entry point for everything the bot records.
 *
 * Writes a JSON line to logs/activity.log and, if configured, an embed to a
 * Discord webhook. The file write is awaited so the audit trail is durable by
 * the time the command returns; the webhook is fired and forgotten so a slow
 * Discord can't add latency to a reply.
 *
 * `event` is a stable dotted name (meet.created, room.posted, command.denied)
 * so the log can be grepped later. `data` becomes JSON fields, and any
 * `summary` key becomes the embed description.
 */
export async function logEvent(level, event, data = {}) {
  const safeLevel = COLORS[level] ? level : "info";
  await writeToFile(safeLevel, event, data);
  void postToWebhook(safeLevel, event, data);
}

export const logReady = (data) => logEvent("info", "bot.ready", data);
export const logCommand = (data) => logEvent("info", "command.received", data);
export const logMeetCreated = (data) => logEvent("info", "meet.created", data);
export const logRoomPosted = (data) => logEvent("info", "room.posted", data);
export const logRoomGenerated = (data) => logEvent("info", "room.generated", data);
export const logScheduled = (data) => logEvent("info", "schedule.created", data);
export const logEnded = (data) => logEvent("info", "conference.ended", data);
export const logBlocked = (data) => logEvent("warn", "request.throttled", data);
export const logDenied = (data) => logEvent("warn", "command.denied", data);
export const logFailure = (data) => logEvent("error", "command.failed", data);

/** Webhook posts a fresh meeting link. Kept as a name the call sites read well. */
export const logMeetingCreated = logMeetCreated;
