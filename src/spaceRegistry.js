import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "spaces.json");

const MAX_ENTRIES = 50;

/**
 * Remembers which spaces the bot handed out, so /end knows what "the latest
 * meeting" means.
 *
 * This is deliberately separate from schedules.json: schedules are
 * single-use pending work, this is a rolling history of spaces, and
 * overwriting one file from two unrelated code paths is how you lose data.
 */
export async function rememberSpace({ name, code, uri, channelId, requestedBy }) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });

  const entries = await loadSpaces();
  const next = [
    { name, code, uri, channelId: channelId ?? null, requestedBy: requestedBy ?? null, at: new Date().toISOString() },
    ...entries.filter((e) => e.name !== name),
  ].slice(0, MAX_ENTRIES);

  await writeFile(FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function loadSpaces() {
  if (!existsSync(FILE)) return [];
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A half-written file shouldn't take the bot down; treat it as empty.
    return [];
  }
}

/** Most recently handed-out space, optionally scoped to one channel. */
export async function latestSpace(channelId) {
  const entries = await loadSpaces();
  return entries.find((e) => e.channelId && e.channelId === channelId) ?? entries[0] ?? null;
}
