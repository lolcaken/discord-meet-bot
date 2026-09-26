// Run this ONCE, locally, on a machine with a browser: `npm run auth`
// It walks you through granting your personal Gmail account permission to
// create Google Meet spaces, then prints a refresh token to save in .env.
//
// This uses your own Google account (not a service account), which is what
// personal Gmail requires.

import "dotenv/config";
import http from "node:http";
import { OAuth2Client } from "google-auth-library";

const PORT = 53682; // arbitrary local port for the OAuth redirect
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error(
    "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in your .env file.\n" +
      "Create an OAuth client of type 'Desktop app' in Google Cloud Console first."
  );
  process.exit(1);
}

const oAuth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

// This is the scope that lets an app create/manage Meet spaces it created.
const SCOPES = ["https://www.googleapis.com/auth/meetings.space.created"];

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline", // required to get a refresh token
  prompt: "consent", // force showing consent screen so we always get a refresh token
  scope: SCOPES,
});

console.log("\n1. Open this URL in a browser and sign in with the Google");
console.log("   account you want to host the meetings:\n");
console.log(authUrl);
console.log("\n2. Approve access. You'll be redirected back automatically.\n");

const server = http
  .createServer(async (req, res) => {
    if (!req.url.startsWith("/oauth2callback")) {
      res.writeHead(404);
      res.end();
      return;
    }

    const url = new URL(req.url, REDIRECT_URI);
    const code = url.searchParams.get("code");

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("No authorization code found in request.");
      return;
    }

    try {
      const { tokens } = await oAuth2Client.getToken(code);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Success! You can close this tab and go back to your terminal.");

      console.log("\n✅ Success! Add this line to your .env file:\n");
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

      if (!tokens.refresh_token) {
        console.log(
          "⚠️  No refresh token was returned. This usually means you've\n" +
            "   already authorized this app before. Go to\n" +
            "   https://myaccount.google.com/permissions , remove access for\n" +
            "   this app, and run `npm run auth` again.\n"
        );
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Token exchange failed. Check your terminal for details.");
      console.error("Token exchange failed:", err);
    } finally {
      server.close();
    }
  })
  .listen(PORT);
