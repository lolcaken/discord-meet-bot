/**
 * Fixed Meet links owned by the bot's host account. These are permanent
 * spaces rather than pooled throwaways, so they're posted on demand instead
 * of being created per request.
 *
 * Keyed by the slot digit. Slot 1 is the default: a typed `meet` posts it.
 * Slots 2+ are reached by typing `meet2`, `meet3`, and so on — there is no
 * typed `meet1`, because `meet` already is that one.
 */
export const PRELOADED_MEETS = {
  1: "tgc-rzea-btb",
  2: "tif-juqf-tsx",
  3: "niq-yxfw-umm",
  4: "qsp-imra-egu",
};

/**
 * Preloaded links to skip when starting a live participant count.
 *
 * The Meet API only lets the owning account read a space, so a code that
 * belongs to a different Google account answers 403 PERMISSION_DENIED and the
 * count can never resolve. Listing them here means no doomed poll is started
 * at all, instead of one wasted call and a log line per post.
 *
 * tif-juqf-tsx is skipped deliberately. The others currently 403 too — if
 * they ever move onto the OAuth account's Google account, deleting them here
 * turns the live count on with no other change.
 */
export const UNCOUNTABLE = ["tif-juqf-tsx"];
