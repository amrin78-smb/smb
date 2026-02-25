// netlify/functions/auth.js
// Lightweight JWT helper (HS256) using the Web Crypto API — no npm deps needed.
import { webcrypto } from "node:crypto";
const crypto = webcrypto;
//
// Usage in every protected function:
//
//   import { requireAuth, unauthorizedResponse } from "./auth.js";
//   const authErr = await requireAuth(event);
//   if (authErr) return authErr;
//
// Environment variables required (set in Netlify dashboard):
//   JWT_SECRET   — any long random string, e.g. openssl rand -hex 32

// ---------- low-level HS256 ----------

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(str) {
  // Pad back to standard base64
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from((str + pad).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function getKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signToken(payload, secret, expiresInSecs = 60 * 60 * 24 * 7) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSecs })
  );
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64url(sig)}`;
}

export async function verifyToken(token, secret) {
  const parts = (token || "").split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [header, claims, sig] = parts;
  const key = await getKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64urlDecode(sig),
    new TextEncoder().encode(`${header}.${claims}`)
  );
  if (!valid) throw new Error("Invalid signature");
  const payload = JSON.parse(base64urlDecode(claims).toString("utf8"));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");
  return payload;
}

// ---------- CORS origin helper ----------

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://smbangkok.netlify.app";

export function corsHeaders(requestOrigin) {
  // If ALLOWED_ORIGIN is *, allow everything (dev mode).
  // Otherwise, echo back the origin only if it matches.
  const origin =
    ALLOWED_ORIGIN === "*"
      ? "*"
      : requestOrigin === ALLOWED_ORIGIN
      ? requestOrigin
      : "";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "vary": "Origin",
  };
}

// ---------- Guard used by every protected function ----------

export async function requireAuth(event) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Misconfigured server — fail closed
    return {
      statusCode: 500,
      headers: corsHeaders(event.headers?.origin),
      body: JSON.stringify({ error: "Server auth not configured" }),
    };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return {
      statusCode: 401,
      headers: corsHeaders(event.headers?.origin),
      body: JSON.stringify({ error: "Missing auth token" }),
    };
  }

  try {
    await verifyToken(token, secret);
    return null; // all good — caller continues
  } catch (e) {
    return {
      statusCode: 401,
      headers: corsHeaders(event.headers?.origin),
      body: JSON.stringify({ error: "Invalid or expired token. Please log in again." }),
    };
  }
}
