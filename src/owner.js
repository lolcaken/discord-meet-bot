/**
 * The owner gate.
 *
 * A few commands see everything the bot can see - every server, every meeting,
 * every person - so they are the owner's alone. Other servers can't ask for
 * them, and can't even tell whether they exist.
 */

/**
 * The bot owner. Yours, and yours alone.
 *
 * Kept as a constant rather than an env var so it can't be changed by
 * accident when a .env is copied around, and so there's exactly one place
 * that says who runs this bot.
 */
export const OWNER_ID = "970921305899687967";

/** The owner as Discord renders them, for the refusal message. */
export const OWNER_MENTION = `<@${OWNER_ID}>`;

/**
 * What someone who isn't the owner gets. The mention is what makes it clear
 * who to ask, and it pings them exactly once, in the channel where it was
 * refused.
 */
export const OWNER_ONLY_MESSAGE = `this command only avalible to daddy moath ${OWNER_MENTION}`;

/**
 * True for the owner, false for everyone else.
 *
 * Discord snowflakes are 64-bit and don't fit in a JS number - the owner's id
 * is above Number.MAX_SAFE_INTEGER, so a number would round
 * 970921305899687967 to 970921305899688000 and quietly stop matching. The
 * comparison is done with BigInt, which holds the full range exactly, and the
 * input is stringified first so a number that lost precision on the way in
 * is caught rather than silently trusted.
 */
export function isOwner(userId) {
  if (userId === undefined || userId === null || userId === "") return false;

  try {
    const given = typeof userId === "bigint" ? userId : BigInt(String(userId).trim());
    return given === BigInt(OWNER_ID);
  } catch {
    // Not a number at all - someone else's id, or junk.
    return false;
  }
}
