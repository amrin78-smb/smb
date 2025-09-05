import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NETLIFY_DATABASE_URL);

export const handler = async () => {
  try {
    const rows = await sql`select now() as server_time`;
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, rows }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }
};

