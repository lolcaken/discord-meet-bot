import { OAuth2Client } from "google-auth-library";
import { withRetry } from "./retry.js";

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
  throw new Error(
    "Missing Google credentials. Run `npm run auth` first and copy the " +
      "printed GOOGLE_REFRESH_TOKEN into your .env file."
  );
}

const oAuth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
oAuth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

/**
 * Pre-fetches and caches an access token immediately, so the *first* /meet
 * after a bot restart doesn't pay the token-refresh round trip on top of
 * the actual meeting-creation call. Safe to call at startup; failures are
 * non-fatal since createOpenMeetSpace will just retry the refresh itself.
 */
export async function warmUpAuth() {
  try {
    await oAuth2Client.getAccessToken();
  } catch (err) {
    console.error("Token warmup failed (will retry on first /meet):", err);
  }
}

/**
 * Reads a meeting space. `name` accepts the resource name from creation
 * (`spaces/{space}`) or a meeting-code alias (`spaces/abc-mnop-xyz`).
 * When someone has joined the call, the returned space has an
 * `activeConference` object populated. Same scope the bot already has
 * (`meetings.space.created`), so no re-auth is needed — usable only on
 * spaces created by this app.
 */
export async function getSpace(name) {
  const { token: accessToken } = await oAuth2Client.getAccessToken();

  const response = await fetch(
    `https://meet.googleapis.com/v2/${name}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Meet API error (${response.status}): ${errorBody}`);
  }

  return response.json();
}

/**
 * Retries the network and server-side failures that resolve on their own.
 * A connect timeout to Google is almost always a blip - a cold route, a
 * congested VPS, a dropped SYN - and the pool would otherwise be permanently
 * one link short until somebody happened to use /meet.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Creates a new Google Meet space with "Open" access, meaning anyone with
 * the link can join immediately - no knocking / host approval required.
 * Uses the Google Meet REST API (meet.googleapis.com/v2/spaces).
 */
export async function createOpenMeetSpace() {
  return withRetry("create space", async () => {
    const { token: accessToken } = await oAuth2Client.getAccessToken();

    const response = await fetch("https://meet.googleapis.com/v2/spaces", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        config: {
          accessType: "OPEN", // <-- anyone with the link joins, no approval
          entryPointAccess: "ALL",
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const err = new Error(`Google Meet API error (${response.status}): ${errorBody}`);
      err.status = response.status;
      throw err;
    }

    const space = await response.json();
    // space.meetingUri looks like https://meet.google.com/abc-defg-hij
    return space;
  });
}

/** Bearer token fetch + JSON POST/PATCH/GET with consistent error text. */
async function call(url, init = {}) {
  return withRetry(`GET ${url.split("/").pop()}`, async () => {
    const { token: accessToken } = await oAuth2Client.getAccessToken();

    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const err = new Error(`Google Meet API error (${response.status}): ${errorBody}`);
      err.status = response.status;
      throw err;
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  });
}

/**
 * Participants of one conference. `activeOnly` keeps just the people still in
 * the call — the API treats a null `latest_end_time` as "hasn't left", which
 * is the only genuinely live presence signal it exposes.
 */
export async function listParticipants(conferenceName, { activeOnly = false, pageSize = 250 } = {}) {
  const query = new URLSearchParams({ pageSize: String(pageSize) });
  if (activeOnly) query.set("filter", "latest_end_time IS NULL");
  return call(`https://meet.googleapis.com/v2/${conferenceName}/participants?${query}`);
}

/**
 * Ends the live conference in a space, dropping everyone currently in the
 * call. Throws when there's no active conference — Google answers
 * FAILED_PRECONDITION ("There is no active conference for the given space"),
 * not a 404.
 */
export async function endActiveConference(name) {
  return call(`https://meet.googleapis.com/v2/${name}:endActiveConference`, {
    method: "POST",
    body: "{}",
  });
}

