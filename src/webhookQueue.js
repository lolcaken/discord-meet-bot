/**
 * The webhook side of logging: one serialised queue that never drops a line.
 *
 * The problem this replaces: every log call fired its own fetch, and Discord
 * rate-limits a webhook to ~30 requests a minute. When the bot hit that wall
 * the old code logged to the console and gave up, so the busiest hour - exactly
 * when you want to read the log - was the hour it went quiet. It also ignored
 * the `retry_after` Discord hands back, so it kept walking into the same wall.
 *
 * The fix is three things at once:
 *
 *   - One worker, one at a time. Requests can't burst past the limit and
 *     can't race each other out of order.
 *   - A 429 parks the whole queue for exactly as long as Discord asked
 *     (`retry_after`), then resumes. Nothing is discarded.
 *   - Requests are paced just under the limit, so 429s are rare instead of
 *     routine. The 429 path stays as a safety net, not the normal case.
 *
 * Terminal failures don't retry: a 404 or 401 means the webhook is gone or the
 * URL is wrong, and retrying forever turns one broken config into a flood.
 *
 * This module never throws and never blocks the caller. `enqueue` returns
 * immediately; logging stays fire-and-forget so a slow Discord can't add
 * latency to a command reply.
 */

import { limit } from "./config.js";

const WEBHOOK_TIMEOUT_MS = 8000;

// Under Discord's 30/minute ceiling, with room for the 429 safety net to do
// its job rather than being load-bearing.
const DEFAULT_MAX_PER_MINUTE = 28;
const DEFAULT_QUEUE_MAX = 200;
const DEFAULT_MAX_ATTEMPTS = 5;

// Backoff for 5xx and network errors, which have no retry_after to obey.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const config = () => ({
  maxPerMinute: num(limit("logWebhookPerMinute"), DEFAULT_MAX_PER_MINUTE),
  queueMax: num(limit("logWebhookQueueMax"), DEFAULT_QUEUE_MAX),
  maxAttempts: num(limit("logWebhookMaxAttempts"), DEFAULT_MAX_ATTEMPTS),
});

/** Discord's 429 body is JSON with retry_after in seconds; anything else is noise. */
function parseRetryAfter(text) {
  try {
    const parsed = JSON.parse(text);
    const seconds = Number(parsed?.retry_after);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

/** Sleeps, but never rejects - a cancelled timer is not a logging failure. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

export function createWebhookQueue({ post, fetchImpl = fetch, now = () => Date.now(), sleepImpl } = {}) {
  const cfg = config();
  const wait = sleepImpl ?? sleep;
  const minGapMs = Math.ceil(60_000 / cfg.maxPerMinute);

  const queue = [];
  let draining = false;
  let lastSentAt = 0;
  let pausedUntil = 0;
  let disabledReason = null;
  let dropped = 0;
  let retries = 0;
  let rateLimits = 0;

  const note = (message) => console.error(`[webhook] ${message}`);

  /** Emit one post, returning what happened so the worker can decide. */
  async function deliver(item) {
    const response = await fetchImpl(item.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "meetbot", embeds: [item.embed] }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (response.ok) return { done: true };

    // Rate limited. Discord says exactly how long to wait, so believe it and
    // pause the whole queue rather than dropping the line.
    if (response.status === 429) {
      const retryAfter = parseRetryAfter(await response.text().catch(() => ""));
      rateLimits++;
      return { done: false, rateLimited: true, retryAfter };
    }

    const body = await response.text().catch(() => "");

    // Gone for good: retrying can't fix a deleted webhook or a bad URL.
    if (response.status === 404 || response.status === 401 || response.status === 403) {
      return { done: true, fatal: true, status: response.status, body };
    }

    return { done: false, retryable: true, status: response.status, body };
  }

  async function post(item) {
    for (let attempt = 1; ; attempt++) {
      // Hold the whole queue open if a 429 told us to.
      const hold = pausedUntil - now();
      if (hold > 0) await wait(hold);

      // Pace to stay under the ceiling.
      const gap = minGapMs - (now() - lastSentAt);
      if (gap > 0) await wait(gap);
      lastSentAt = now();

      try {
        const result = await deliver(item);

        if (result.fatal) {
          disabledReason = `HTTP ${result.status} - the webhook is gone or the URL is wrong`;
          note(`disabled: ${disabledReason}`);
          return true;
        }
        if (result.done) return true;

        if (result.rateLimited) {
          // No retry_after means Discord gave us something unreadable; fall back
          // to a full window rather than hammering it immediately.
          const waitMs = result.retryAfter ?? minGapMs * 3;
          pausedUntil = now() + waitMs;
          note(`rate limited, pausing the queue ${Math.ceil(waitMs / 1000)}s`);
          retries++;
          continue; // same item, no attempt consumed: this isn't a failure
        }

        // Retryable server-side failure.
        retries++;
        if (attempt >= cfg.maxAttempts) {
          note(`giving up on ${item.event} after ${attempt} tries (HTTP ${result.status})`);
          return true; // drop it, but only after a real effort
        }
        await wait(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
      } catch (err) {
        // Network error or timeout: the host's connection, not Discord's fault.
        retries++;
        if (attempt >= cfg.maxAttempts) {
          const code = err?.code ?? err?.cause?.code ?? "network";
          note(`giving up on ${item.event} after ${attempt} tries (${code})`);
          return true;
        }
        await wait(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
      }
    }
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        // A fatal failure disables the queue; keep the backlog for inspection
        // rather than hammering a webhook that no longer exists.
        if (disabledReason) break;
        const item = queue[0];
        await post(item);
        // post() returns true once the item is settled (delivered, given up on,
        // or the webhook died), so shift either way.
        queue.shift();
      }
    } finally {
      draining = false;
    }
  }

  return {
    /** Add one post. Never throws, never blocks. */
    enqueue(item) {
      if (disabledReason) return;
      // Full queue: the oldest log is the least useful, so it goes first and
      // the loss is counted rather than silent.
      if (queue.length >= cfg.queueMax) {
        queue.shift();
        dropped++;
      }
      queue.push(item);
      void drain();
    },

    /** Live counters, for tests and the /servers style introspection. */
    stats: () => ({
      pending: queue.length,
      dropped,
      retries,
      rateLimits,
      disabledReason,
    }),

    /** Test seam: let the worker settle. */
    async idle() {
      while (draining || (queue.length && !disabledReason)) await wait(5);
    },
  };
}