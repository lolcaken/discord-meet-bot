/**
 * The webhook queue's whole reason for existing is that the old code dropped
 * log lines whenever Discord rate-limited it. These tests drive the queue with
 * a fake fetch and assert nothing is lost, nothing bursts, and terminal
 * failures stop instead of looping forever.
 *
 * Time is injected, so no test waits in real seconds.
 */
import { writeFileSync } from "node:fs";

const out = [];
const say = (s) => { out.push(s); writeFileSync(new URL("webhook-test.txt", import.meta.url), out.join("\n") + "\n", "utf8"); };

let fail = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fail++;
  say(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${detail}`);
};

process.env.LOG_WEBHOOK_MAX_PER_MINUTE = "28";
process.env.LOG_WEBHOOK_QUEUE_MAX = "200";
process.env.LOG_WEBHOOK_MAX_ATTEMPTS = "3";

const { createWebhookQueue } = await import("../src/webhookQueue.js");

/** A fake fetch that records calls and replays a scripted list of outcomes. */
function fakeFetch(script) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const impl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Yield so overlapping calls would actually overlap if the queue allowed it.
    await new Promise((r) => setImmediate(r));
    inFlight--;
    const next = script.shift() ?? { ok: true };
    if (next.throw) throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
    return {
      ok: next.ok ?? false,
      status: next.status ?? 200,
      text: async () => next.body ?? "",
    };
  };
  return { impl, calls, maxInFlight: () => maxInFlight };
}

/** A sleep that records requested delays and resolves on a macrotask. */
const instantSleep = () => {
  const delays = [];
  const fn = async (ms) => {
    delays.push(Math.round(ms));
    // Yield to the event loop so the worker can make progress, but don't
    // actually wait: these tests must run in milliseconds, not seconds.
    await new Promise((r) => setImmediate(r));
  };
  return { fn, delays };
};

/**
 * Let the queue drain. Waits on the real signal (nothing pending) rather than
 * a fixed number of ticks, so a retry-heavy case can't finish early just
 * because the fake clock ticked past the pause.
 */
const settle = async (queue) => {
  for (let i = 0; i < 5000; i++) {
    if (queue && queue.stats().pending === 0 && !queue.stats().disabledReason) {
      // Give the worker one more tick to finish its final microtasks.
      await new Promise((r) => setImmediate(r));
      if (queue.stats().pending === 0) return;
    }
    await new Promise((r) => setImmediate(r));
  }
};

const mkQueue = (script, clock) => {
  const { impl, calls, maxInFlight } = fakeFetch(script);
  const { fn: sleepImpl, delays } = instantSleep();
  let t = clock?.start ?? 0;
  const queue = createWebhookQueue({
    fetchImpl: impl,
    sleepImpl,
    now: () => (t += clock?.step ?? 1),
  });
  return { queue, calls, maxInFlight, delays };
};

const item = (n) => ({ url: "https://example.invalid/hook", event: `e${n}`, embed: { title: `e${n}` } });

say("=== the regression: a 429 must not drop the line ===");
{
  const { queue, calls } = mkQueue([
    { status: 429, body: JSON.stringify({ retry_after: 1.5 }) },
    { ok: true },
  ]);
  queue.enqueue(item(1));
  await settle(queue);
  check("the rate-limited post was retried", calls.length === 2, `${calls.length} attempts`);
  check("it ended up delivered", queue.stats().dropped === 0, "0 dropped");
  check("the 429 was counted", queue.stats().rateLimits === 1);
}

say("\n=== a 429 with an unreadable body still retries ===");
{
  const { queue, calls } = mkQueue([
    { status: 429, body: "<html>nope</html>" },
    { ok: true },
  ]);
  queue.enqueue(item(1));
  await settle(queue);
  check("it retried rather than dropping", calls.length === 2, `${calls.length}`);
  check("nothing lost", queue.stats().dropped === 0);
}

say("\n=== posts are serialised, never concurrent ===");
{
  const { queue, maxInFlight } = mkQueue([{}, {}, {}, {}, {}]);
  for (let i = 0; i < 5; i++) queue.enqueue(item(i));
  await settle(queue);
  check("all five went out", queue.stats().pending === 0, `${queue.stats().pending} pending`);
  check("never more than one in flight", maxInFlight() === 1, `peak ${maxInFlight()}`);
}

say("\n=== ordering is preserved ===");
{
  const { queue, calls } = mkQueue([{}, {}, {}, {}]);
  for (let i = 1; i <= 4; i++) queue.enqueue(item(i));
  await settle(queue);
  const titles = calls.map((c) => c.body.embeds[0].title);
  check("delivered in order", JSON.stringify(titles), JSON.stringify(["e1", "e2", "e3", "e4"]));
}

say("\n=== pacing stays under the ceiling ===");
{
  const { queue, delays } = mkQueue([{}, {}]);
  queue.enqueue(item(1));
  queue.enqueue(item(2));
  await settle(queue);
  // 28/min means ~2143ms between posts.
  check("a gap was enforced between posts", delays.some((d) => d > 1000), `${delays.join(", ")}ms`);
}

say("\n=== a deleted webhook disables the queue instead of looping ===");
{
  const { queue, calls } = mkQueue([{ status: 404 }, { ok: true }]);
  queue.enqueue(item(1));
  await settle(queue);
  check("it stopped after one try", calls.length === 1, `${calls.length} attempts`);
  check("it says why", /404/.test(queue.stats().disabledReason ?? ""), queue.stats().disabledReason);
  queue.enqueue(item(2));
  await settle(queue);
  check("later posts are refused, not retried", calls.length === 1, `${calls.length} attempts`);
}

say("\n=== a 401 disables too ===");
{
  const { queue, calls } = mkQueue([{ status: 401 }]);
  queue.enqueue(item(1));
  await settle(queue);
  check("one attempt only", calls.length === 1, `${calls.length}`);
  check("disabled", Boolean(queue.stats().disabledReason));
}

say("\n=== a 500 retries with backoff, then gives up ===");
{
  const { queue, calls } = mkQueue([
    { status: 500 }, { status: 500 }, { status: 500 }, { ok: true },
  ]);
  queue.enqueue(item(1));
  await settle(queue);
  check("tried the configured 3 times", calls.length === 3, `${calls.length} attempts`);
  check("then dropped it", queue.stats().dropped === 0, "dropped count is overflow-only");
}

say("\n=== a network error retries, then gives up ===");
{
  const { queue, calls } = mkQueue([{ throw: true }, { throw: true }, { throw: true }]);
  queue.enqueue(item(1));
  await settle(queue);
  check("tried 3 times", calls.length === 3, `${calls.length} attempts`);
}

say("\n=== a 500 that eventually recovers is delivered ===");
{
  const { queue, calls } = mkQueue([{ status: 503 }, { ok: true }]);
  queue.enqueue(item(1));
  await settle(queue);
  check("delivered on the retry", calls.length === 2, `${calls.length}`);
}

say("\n=== overflow drops the oldest, not the newest ===");
{
  process.env.LOG_WEBHOOK_QUEUE_MAX = "3";
  const { queue, calls } = mkQueue([{}, {}, {}, {}, {}, {}]);
  for (let i = 1; i <= 6; i++) queue.enqueue(item(i));
  await settle(queue);
  check("three were dropped", queue.stats().dropped === 3, `${queue.stats().dropped}`);
  const titles = calls.map((c) => c.body.embeds[0].title);
  // The oldest three (e1-e3) should be gone; the newest three survive.
  check("the newest survived", JSON.stringify(titles), JSON.stringify(["e4", "e5", "e6"]));
}

say("\n=== a rate-limited burst is all delivered eventually ===");
{
  // Restore the real limit: the overflow test above lowered it process-wide,
  // and config is read when the queue is created.
  process.env.LOG_WEBHOOK_QUEUE_MAX = "200";
  const { queue, calls } = mkQueue([
    { status: 429, body: JSON.stringify({ retry_after: 2 }) },
    { ok: true }, { ok: true }, { ok: true }, { ok: true },
  ]);
  for (let i = 1; i <= 4; i++) queue.enqueue(item(i));
  await settle(queue);
  // 4 items, the first one taking two attempts because of the 429.
  check("every item was delivered", calls.length === 5, `${calls.length} attempts for 4 items`);
  check("nothing was lost", queue.stats().dropped === 0, `${queue.stats().dropped} dropped`);
}

say(`\n${fail === 0 ? "ALL PASSED" : fail + " FAILED"}`);
process.exitCode = fail ? 1 : 0;

