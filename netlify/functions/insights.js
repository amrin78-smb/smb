// netlify/functions/insights.js
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NETLIFY_DATABASE_URL);

const ok = (data) => ({
  statusCode: 200,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  body: JSON.stringify(data),
});
const err = (status, msg) => ({
  statusCode: status,
  headers: { "access-control-allow-origin": "*" },
  body: typeof msg === "string" ? msg : JSON.stringify({ error: msg?.message || msg }),
});

function parseBody(event) {
  try { return JSON.parse(event.body || "{}"); } catch { return {}; }
}

function toISO(d) {
  if (!d) return null;
  const s = String(d).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST,OPTIONS",
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
    if (event.httpMethod !== "POST") return err(405, "Method Not Allowed");

    const body = parseBody(event);
    const action = body?.action || "summary";
    const dateFrom = toISO(body?.dateFrom) || "1900-01-01";
    const dateTo = toISO(body?.dateTo) || "2999-12-31";

    if (action === "summary") {
      const [monthly, topProducts, topCustomers] = await Promise.all([
        sql`select to_char(date_trunc('month', o.date), 'YYYY-MM') as ym, sum(coalesce(o.total, 0)) as total
            from orders o
            where o.date between ${dateFrom} and ${dateTo}
            group by 1
            order by 1 asc;`,
        sql`select p.name as product, sum(oi.qty) as qty, sum(oi.qty * oi.price) as amount
            from order_items oi
            join orders o on o.id = oi.order_id
            join products p on p.id = oi.product_id
            where o.date between ${dateFrom} and ${dateTo}
            group by p.name
            order by qty desc
            limit 10;`,
        sql`select c.id, c.name, count(*) as orders, sum(coalesce(o.total,0)) as total
            from orders o
            join customers c on c.id = o.customer_id
            where o.date between ${dateFrom} and ${dateTo}
            group by c.id, c.name
            order by total desc
            limit 10;`,
      ]);
      return ok({ monthly, topProducts, topCustomers, range: { dateFrom, dateTo } });
    }

    if (action === "customer") {
      const customerId = Number(body?.customerId || 0);
      if (!customerId) return err(400, "customerId required");
      const [summary, orders] = await Promise.all([
        sql`select c.id, c.name, count(o.*) as orders, sum(coalesce(o.total,0)) as total, max(o.date) as last_order
            from customers c
            left join orders o on o.customer_id = c.id and o.date between ${dateFrom} and ${dateTo}
            where c.id = ${customerId}
            group by c.id, c.name;`,
        sql`select o.id, o.order_code, o.date, o.subtotal, o.delivery_fee, o.total, o.notes
            from orders o
            where o.customer_id = ${customerId}
              and o.date between ${dateFrom} and ${dateTo}
            order by o.date desc, o.id desc
            limit 500;`,
      ]);
      return ok({ summary: summary?.[0] || null, orders });
    }

    return err(400, "Unknown action");
  } catch (e) {
    console.error(e);
    return err(500, e.message || "Server error");
  }
};
