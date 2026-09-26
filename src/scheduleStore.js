import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const FILE_PATH = path.join(DATA_DIR, "schedules.json");

async function ensureFile() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(FILE_PATH)) await writeFile(FILE_PATH, "[]", "utf8");
}

/** Returns the full array of pending schedules. */
export async function loadSchedules() {
  await ensureFile();
  const raw = await readFile(FILE_PATH, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function save(schedules) {
  await ensureFile();
  await writeFile(FILE_PATH, JSON.stringify(schedules, null, 2), "utf8");
}

/**
 * Adds a schedule and returns it (with a generated id).
 * schedule: { runAt, channelId, guildId, title, notifyRoleId, requestedBy }
 */
export async function addSchedule(schedule) {
  const schedules = await loadSchedules();
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...schedule };
  schedules.push(entry);
  await save(schedules);
  return entry;
}

/** Removes a schedule by id (call this once it has fired). */
export async function removeSchedule(id) {
  const schedules = await loadSchedules();
  await save(schedules.filter((s) => s.id !== id));
}
