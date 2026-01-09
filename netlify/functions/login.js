// netlify/functions/login.js
// Simple server-side credential check (keeps credentials out of frontend bundle)
export const handler = async (event) => {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  };

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...headers,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Invalid JSON body" }),
    };
  }

  const { username, password } = payload;

  // Keep the same credentials as before (per your request)
  const valid =
    (username === "emilyedrin" && password === "Amed1920") ||
    (username === "amedsmb" && password === "Amed1920");

  if (!valid) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ ok: false, error: "Invalid username or password" }),
    };
  }

  // Keep response minimal; frontend can store user in localStorage as before
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, user: username }),
  };
};
