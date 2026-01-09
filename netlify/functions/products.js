// netlify/functions/products.js
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NETLIFY_DATABASE_URL);

// small helpers
const ok = (data, status = 200) => ({
  statusCode: status,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*", // allow browser calls
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
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods":
            "GET,POST,PUT,DELETE,PATCH,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
        body: "",
      };
    }


// Simple auth guard: require x-smb-user header (set by frontend after login)
const _h = Object.fromEntries(
  Object.entries(event.headers || {}).map(([k, v]) => [String(k).toLowerCase(), v])
);
if (!_h["x-smb-user"]) {
  return err(401, "Unauthorized");
}

    // GET: list products (active only by default)
    if (event.httpMethod === "GET") {
      const includeInactive =
        event.queryStringParameters?.include_inactive === "1";

      const rows = includeInactive
        ? await sql/*sql*/`
            select id, name, price, active
            from products
            order by name
          `
        : await sql/*sql*/`
            select id, name, price, active
            from products
            where active = true
            order by name
          `;

      return ok(rows);
    }

    // POST: add product
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      if (!body.name) return err(400, "name is required");
      const price = Number(body.price ?? 0);
      const active = price > 0; // auto-inactive if 0

      const [row] = await sql/*sql*/`
        insert into products (name, price, active)
        values (${body.name}, ${price}, ${active})
        returning id, name, price, active
      `;
      return ok(row, 201);
    }

    // PUT: update product
    if (event.httpMethod === "PUT") {
      const body = JSON.parse(event.body || "{}");
      if (!body.id) return err(400, "id is required");
      const price = Number(body.price ?? 0);
      const active = price > 0; // keep consistent

      await sql/*sql*/`
        update products
        set name=${body.name},
            price=${price},
            active=${active}
        where id=${body.id}
      `;
      return ok({ updated: true });
    }

    // DELETE: soft delete (set active=false)
    if (event.httpMethod === "DELETE") {
      const id = Number(event.queryStringParameters?.id);
      if (!id) return err(400, "id query param is required");

      await sql/*sql*/`
        update products
        set active = false
        where id=${id}
      `;
      return ok({ deleted: true, soft: true });
    }

    // PATCH: explicitly toggle active flag
    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body || "{}");
      if (!body.id || typeof body.active !== "boolean") {
        return err(400, "id and active required");
      }
      const [row] = await sql/*sql*/`
        update products
        set active=${body.active}
        where id=${body.id}
        returning id, name, price, active
      `;
      return ok(row);
    }

    return err(405, "Method Not Allowed");
  } catch (e) {
    return err(500, { error: e.message || "Server error" });
  }
};
