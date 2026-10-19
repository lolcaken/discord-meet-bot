import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * config.json - the switches that turn features on and off.
 *
 * This file is meant to be edited by whoever runs the bot, and it is
 * committed to the repository, so the settings travel with the code. Secrets
 * are a different matter and stay in .env: a token in a committed file is a
 * token in everybody's git history.
 *
 * The loader is deliberately forgiving. A missing file means "everything on",
 * because that is what the bot did before config.json existed and a fresh
 * clone should work without touching anything. A malformed file means
 * "everything on" too, with a loud warning - a typo in a switch should not
 * stop the bot from starting, but it should not be silent either.
 *
 * Unknown keys are ignored rather than rejected, so a config written for a
 * newer version of the bot still loads.
 */

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_FILE = path.join(APP_DIR, "config.json");

/** The defaults, used when there's no config file or it can't be read. */
const DEFAULTS = {
  commands: {
    meet: true,
    rand: true,
    last: true,
    schedule: true,
    end: true,
    servers: true,
    roster: true,
    globalroster: true,
    globallast: true,
  },
  features: {
    standingRooms: true,
    participantCounter: true,
    webhookLogging: true,
    schedules: true,
    inventory: true,
  },
  limits: {
    cooldownSeconds: 5,
    maxScheduleMinutes: 10080,
    poolSize: 5,
    logWebhookPerMinute: 28,
    logWebhookQueueMax: 200,
    logWebhookMaxAttempts: 5,
  },
};

const isBool = (v) => typeof v === "boolean";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Which environment variable can override each limit, for people who prefer
 * to set things in .env rather than edit config.json.
 */
const ENV_FOR_LIMIT = {
  cooldownSeconds: "MEET_COOLDOWN_SECONDS",
  maxScheduleMinutes: "MAX_SCHEDULE_MINUTES",
  poolSize: "MEETING_POOL_SIZE",
  logWebhookPerMinute: "LOG_WEBHOOK_MAX_PER_MINUTE",
  logWebhookQueueMax: "LOG_WEBHOOK_QUEUE_MAX",
  logWebhookMaxAttempts: "LOG_WEBHOOK_MAX_ATTEMPTS",
};

/** Merge one section of the file over the defaults, keeping the right types. */
function mergeSection(defaults, incoming, kind, warnings) {
  const out = { ...defaults };
  if (!incoming || typeof incoming !== "object") {
    if (incoming !== undefined) warnings.push(`${kind} is not an object, ignoring it.`);
    return out;
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in defaults)) continue; // unknown key: ignore, so old configs work
    if (kind === "limits") {
      if (isNum(value) && value > 0) out[key] = value;
      else warnings.push(`limits.${key} must be a positive number, using ${defaults[key]}.`);
    } else if (isBool(value)) {
      out[key] = value;
    } else {
      warnings.push(`${kind}.${key} must be true or false, using ${defaults[key]}.`);
    }
  }
  return out;
}

let cached = null;

/**
 * The config, loaded once and remembered.
 *
 * @param {boolean} reload read the file again instead of using the cache
 */
export function loadConfig({ reload = false } = {}) {
  if (cached && !reload) return cached;

  const warnings = [];
  let raw = {};

  if (!existsSync(CONFIG_FILE)) {
    // No config file at all: the defaults are the answer, and that's fine.
    raw = {};
  } else {
    try {
      raw = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    } catch (err) {
      warnings.push(`config.json could not be parsed (${err.message}). Using defaults.`);
      raw = {};
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      // $comment and any other stray keys are ignored on purpose.
      delete raw.$comment;
    } else if (raw) {
      warnings.push("config.json is not an object. Using defaults.");
      raw = {};
    }
  }

  cached = {
    commands: mergeSection(DEFAULTS.commands, raw.commands, "commands", warnings),
    features: mergeSection(DEFAULTS.features, raw.features, "features", warnings),
    limits: mergeSection(DEFAULTS.limits, raw.limits, "limits", warnings),
  };

  for (const warning of warnings) console.warn(`[config] ${warning}`);

  return cached;
}

/** Is this command switched on? */
export function commandEnabled(name) {
  const { commands } = loadConfig();
  // An unknown command name is treated as off, so a typo in config.json
  // can't accidentally expose something.
  return commands[name] === true;
}

/** Is this feature switched on? */
export function featureEnabled(name) {
  const { features } = loadConfig();
  return features[name] === true;
}

/**
 * A limit from config.json, with the default as a fallback.
 *
 * The environment still wins if it has a value: someone who set
 * MEETING_POOL_SIZE in their .env shouldn't have it silently ignored just
 * because config.json exists now.
 */
export function limit(name) {
  const { limits } = loadConfig();
  const fromEnv = Number(process.env[ENV_FOR_LIMIT[name]]);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return limits[name] ?? DEFAULTS.limits[name];
}

/** Where the config was read from, for the startup log. */
export const configPath = CONFIG_FILE;

/** True when a config.json is actually present, for the startup log. */
export const hasConfigFile = () => existsSync(CONFIG_FILE);
