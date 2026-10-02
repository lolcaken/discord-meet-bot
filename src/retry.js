/**
 * Deciding when a failed request is worth repeating.
 *
 * Both upstreams this bot talks to sit behind edge networks that blip: Google
 * (meet.googleapis.com) and Cloudflare, which fronts Discord. A refused or
 * reset connection there says nothing about whether the request was correct,
 * so trying again is the right response. A 400/401/403/404 means the request
 * itself is wrong, and repeating it only triples the latency before the same
 * error.
 */

const TRANSIENT_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Network-level errors (DNS, reset, refused, timeout) carry no HTTP status. */
export function isTransient(err) {
  if (TRANSIENT_CODES.has(err?.status)) return true;

  const code = err?.code ?? err?.cause?.code ?? "";
  if (
    typeof code === "string" &&
    /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_)/.test(code)
  ) {
    return true;
  }

  // Node wraps several causes in an AggregateError; any refused address counts.
  if (Array.isArray(err?.errors) && err.errors.length) {
    return err.errors.some((e) => isTransient(e));
  }

  // fetch surfaces a bare "fetch failed" with the real reason on .cause.
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;

  return false;
}

export async function withRetry(label, fn, { attempts = MAX_ATTEMPTS } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === attempts) throw err;
      await sleep(BASE_BACKOFF_MS * attempt);
      console.warn(`${label} attempt ${attempt} failed (${err.code ?? err.message}); retrying`);
    }
  }
  throw lastError;
}
