import { appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "activity.log");

async function ensureLogDir() {
  if (!existsSync(LOG_DIR)) await mkdir(LOG_DIR, { recursive: true });
}

async function writeToFile(entry) {
  try {
    await ensureLogDir();
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
    await appendFile(LOG_FILE, line + "\n", "utf8");
  } catch (err) {
    console.error("Failed to write activity log file:", err);
  }
}

async function postToWebhook(entry) {
  const webhookUrl = process.env.DISCORD_LOG_WEBHOOK_URL;
  if (!webhookUrl) return; // logging to a webhook is optional

  const { username, userId, context, meetingUri, meetingCode, via } = entry;

  const embed = {
    title: "🎥 New Meet link created",
    color: 0x00897b,
    fields: [
      { name: "Created by", value: `${username} (\`${userId}\`)`, inline: true },
      { name: "Via", value: via, inline: true },
      { name: "Where", value: context, inline: true },
      { name: "Meeting", value: meetingUri },
      { name: "Code", value: `\`${meetingCode}\``, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!response.ok) {
      console.error(`Webhook log failed (${response.status}):`, await response.text());
    }
  } catch (err) {
    console.error("Webhook log failed:", err);
  }
}

/**
 * Logs a meeting-creation event to both the local log file and the
 * configured Discord webhook (if any).
 * entry: { username, userId, context, meetingUri, meetingCode, via }
 */
export async function logMeetingCreated(entry) {
  await Promise.all([writeToFile(entry), postToWebhook(entry)]);
}
