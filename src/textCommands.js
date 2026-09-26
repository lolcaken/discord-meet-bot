/**
 * Plain-text commands for servers: just `meet`, `meet2`…`meetN` and `rand`.
 *
 * `meet` posts preloaded link 1 — the default one — so there's deliberately
 * no typed `meet1`; typing that does nothing. The preloaded links are
 * text-only too: there's no /meet1 slash command, so they don't clutter the
 * command palette. `/meet` stays random from the pool.
 *
 * Returns null for anything that isn't one of those exact words, which is
 * what keeps ordinary conversation safe: "lets meet tomorrow" and
 * "i met him today" both fall through.
 */

// Slot 1 is reached by typing plain `meet`, so this deliberately skips it.
// Any slot >= 2 parses; the handler ignores ones with no entry in
// PRELOADED_MEETS, which keeps this from needing to know the slot count.
const PRELOADED = /^meet([2-9]|[1-9][0-9]+)$/;

export function parseTextCommand(content) {
  if (typeof content !== "string") return null;

  // A leading "!" is accepted as a familiar nudge, but never required.
  const text = content.trim().replace(/^!/, "").trim();
  if (!text || text.startsWith("/")) return null; // "/" is the slash-command path

  // No arguments at all: the message has to be exactly the command, so a
  // command word inside a sentence never fires.
  const word = text.toLowerCase();
  if (word !== "meet" && word !== "rand" && !PRELOADED.test(word)) return null;

  return { name: word, options: { name: word } };
}
