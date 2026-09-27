/**
 * Fixed Meet links owned by the bot's host account. These are permanent
 * spaces rather than pooled throwaways, so they're posted on demand instead
 * of being created per request.
 *
 * Every code here was created through this project's own OAuth token, which
 * is what makes the live participant count work: the Meet API scopes space
 * access per Google Cloud project, so a space minted elsewhere in the same
 * Gmail account still answers 403 PERMISSION_DENIED here.
 *
 * Keyed by the slot digit. Slot 1 is the default: a typed `meet` (or `cd`)
 * posts it. Slots 2+ are reached by typing `meet2`, `meet3`, and so on —
 * there is no typed `meet1`, because `meet` already is that one.
 */
export const PRELOADED_MEETS = {
  1: "tke-sucv-wzi",
  2: "xgs-bdij-vpp",
  3: "bgh-huto-jiv",
  4: "xnv-kkzp-het",
};
