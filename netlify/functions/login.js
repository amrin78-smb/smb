// netlify/functions/login.js
// Validates credentials from environment variables and issues a signed JWT.
//
// Required env vars (set in Netlify dashboard → Site configuration → Environment variables):
//   SMB_USER_1        e.g. "emilyedrin"
//   SMB_PASS_1        e.g. "some-strong-password"
//   SMB_USER_2        e.g. "amedsmb"
//   SMB_PASS_2        e.g. "another-strong-password"
//   JWT_SECRET        e.g. output of: openssl rand -hex 32

import { signToken, corsHeaders } from "./auth.js";

export const handler = async (event) => {
  const origin = event.headers?.origin;
  const cors = corsHeaders(origin);

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return {
      statusCode: 400,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Invalid JSON body" }),
    };
  }

  const { username, password } = payload;
  if (!username || !password) {
    return {
      statusCode: 400,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "username and password are required" }),
    };
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("JWT_SECRET env var is not set");
    return {
      statusCode: 500,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Server misconfigured" }),
    };
  }

  // Build a credential map from env vars.
  // Supports up to 5 users: SMB_USER_1/SMB_PASS_1 ... SMB_USER_5/SMB_PASS_5
  const validUsers = {};
  for (let i = 1; i <= 5; i++) {
    const u = process.env[`SMB_USER_${i}`];
    const p = process.env[`SMB_PASS_${i}`];
    if (u && p) validUsers[u] = p;
  }

  const expectedPass = validUsers[username];
  if (!expectedPass || expectedPass !== password) {
    // Same generic message for both cases to avoid leaking which usernames exist
    return {
      statusCode: 401,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Invalid username or password" }),
    };
  }

  // Issue a JWT valid for 7 days
  const token = await signToken({ sub: username }, secret, 60 * 60 * 24 * 7);

  return {
    statusCode: 200,
    headers: { ...cors, "content-type": "application/json" },
    body: JSON.stringify({ ok: true, user: username, token }),
  };
};
