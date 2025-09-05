import { neon } from "@netlify/neon";

// reads NETLIFY_DATABASE_URL automatically
const sql = neon();

export const handler = async () => {
  try {
    const rows = await sql`select now() as server_time`;
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, rows }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }
};
