// netlify/functions/customers.js
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NETLIFY_DATABASE_URL);

// helpers
const ok = (data, status = 200) => ({
  statusCode: status,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(data),
});
const err = (status, message) => ({
  statusCode: status,
  headers: { "access-control-allow-origin": "*" },
  body: typeof message === "string" ? message : JSON.stringify(message),
});

export const handler = async (event) => {
  try {
    // CORS preflight (optional)
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
        body: "",
      };
    }

    if (event.httpMethod === "GET") {
      const rows = await sql`
        select id, name, phone, address, grabwin, grabcar, nationality
        from customers
        order by name
      `;
      return ok(rows);
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      if (!body.name) return err(400, "name is required");

      const [row] = await sql`
        insert into customers (name, phone, address, grabwin, grabcar, nationality)
        values (
          ${body.name},
          ${body.phone || null},
          ${body.address || null},
          ${body.grabwin || null},
          ${body.grabcar || null},
          ${body.nationality || null}
        )
        returning id, name, phone, address, grabwin, grabcar, nationality
      `;
      return ok(row, 201);
    }

    if (event.httpMethod === "PUT") {
      const body = JSON.parse(event.body || "{}");
      if (!body.id) return err(400, "id is required");

      await sql`
        update customers set
          name=${body.name},
          phone=${body.phone},
          address=${body.address},
          grabwin=${body.grabwin},
          grabcar=${body.grabcar},
          nationality=${body.nationality}
        where id=${body.id}
      `;
      return ok({ updated: true });
    }

    if (event.httpMethod === "DELETE") {
      const id = Number(event.queryStringParameters?.id);
      if (!id) return err(400, "id query param is required");
      await sql`delete from customers where id=${id}`;
      return ok({ deleted: true });
    }

    return err(405, "Method Not Allowed");
  } catch (e) {
    return err(500, { error: e.message || "Server error" });
  }
};

