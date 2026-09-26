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
