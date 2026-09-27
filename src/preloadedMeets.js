/**
 * Fixed Meet links owned by the bot's host account. These are permanent
 * spaces rather than pooled throwaways, so they're posted on demand instead
 * of being created per request.
 *
 * Every code here was created through this project's own OAuth token, which
 * is what makes the live participant count work: the Meet API scopes space
 * access per Google Cloud project, so a space minted elsewhere in the same
 * Gmail account still answers 403 PERMISSION_DENIED and the count can never
 * resolve for it.
 *
 * The codes are whatever Google assigned - meeting codes can't be chosen, the
 * API ignores any code you ask for - so these were picked by minting a batch
 * and keeping the best-formed ones.
 *
 * Keyed by the slot digit. Slot 1 is the default: a typed `meet` (or `cd`)
 * posts it. Slots 2+ are reached by typing `meet2`, `meet3`, and so on —
 * there is no typed `meet1`, because `meet` already is that one.
 */
export const PRELOADED_MEETS = {
  1: "ggv-nove-xkr",
  2: "dbp-ttaz-vuc",
  3: "wqw-ajqo-cnt",
  4: "fxf-ixhq-ucm",
};
