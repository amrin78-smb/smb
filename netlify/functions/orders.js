// netlify/functions/orders.js
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NETLIFY_DATABASE_URL);

// ----- helpers -----
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
const toNumber = (v) => (v == null ? 0 : Number(v));
const ddmmyy = (dateStr) => {
  const [y, m, d] = String(dateStr).split("-");
  return `${d}${m}${y.slice(2)}`;
};

// ----- handler -----
export const handler = async (event) => {
  try {
    // CORS preflight
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


// Simple auth guard: require x-smb-user header (set by frontend after login)
const _h = Object.fromEntries(
  Object.entries(event.headers || {}).map(([k, v]) => [String(k).toLowerCase(), v])
);
if (!_h["x-smb-user"]) {
  return err(401, "Unauthorized");
}

    const { httpMethod, queryStringParameters } = event;

    // -------- GET: months list / days in a month / orders for a date / recent --------
    if (httpMethod === "GET") {
      const months = queryStringParameters?.months;
      const days = queryStringParameters?.days;        // expects YYYY-MM
      const date = queryStringParameters?.date;        // expects YYYY-MM-DD

      if (months) {
        const rows = await sql`
          select distinct to_char(date, 'YYYY-MM') as m
          from orders
          order by m desc
        `;
        return ok(rows.map((r) => r.m));
      }

      if (days) {
        const rows = await sql`
          select distinct to_char(date, 'YYYY-MM-DD') as d
          from orders
          where to_char(date, 'YYYY-MM') = ${days}
          order by d desc
        `;
        return ok(rows.map((r) => r.d));
      }

      if (date) {
        // all orders for a specific day (with customer name + items)
        const orders = await sql`
          select o.id, o.date, o.customer_id as "customerId",
                 o.subtotal, o.delivery_fee as "deliveryFee", o.total,
                 o.notes, o.order_code as "orderCode",
                 c.name as "customerName"
          from orders o
          join customers c on c.id = o.customer_id
          where o.date = ${date}
          order by o.id asc
        `;
        if (orders.length === 0) return ok([]);

        const orderIds = orders.map((o) => o.id);
        const items = await sql`
          select oi.id, oi.order_id as "orderId", oi.product_id as "productId",
                 oi.qty, oi.price, p.name as "productName"
          from order_items oi
          join products p on p.id = oi.product_id
          where oi.order_id = any(${orderIds})
          order by oi.id asc
        `;
        const byOrder = {};
        for (const o of orders) byOrder[o.id] = [];
        for (const it of items) byOrder[it.orderId].push(it);

        const merged = orders.map((o) => ({ ...o, items: byOrder[o.id] || [] }));
        return ok(merged);
      }

      // default: most recent 100 (no items for brevity)
      const rows = await sql`
        select id, date, customer_id as "customerId",
               subtotal, delivery_fee as "deliveryFee", total,
               notes, order_code as "orderCode"
        from orders
        order by id desc
        limit 100
      `;
      return ok(rows);
    }

    // -------- POST: create or CONSOLIDATE an order --------
    if (httpMethod === "POST") {
      // NOTE: do NOT default deliveryFee here; keep undefined unless client sends it.
      const body = JSON.parse(event.body || "{}");
      const { date, customerId, items = [], deliveryFee, notes = "" } = body;

      if (!date) return err(400, "date is required");
      if (!customerId) return err(400, "customerId is required");
      if (!Array.isArray(items) || items.length === 0) return err(400, "items[] is required");

      // check existing (same date + customer) -> consolidate
      const existing = await sql`
        select id, order_code as "orderCode", notes, delivery_fee as "deliveryFee"
        from orders
        where date = ${date} and customer_id = ${customerId}
        limit 1
      `;

      if (existing.length) {
        const o = existing[0];

        // merge items by product
        for (const it of items) {
          const productId = Number(it.productId);
          const qty = toNumber(it.qty);
          const price = toNumber(it.price);
          const prev = await sql`
            select id, qty, price
            from order_items
            where order_id = ${o.id} and product_id = ${productId}
            limit 1
          `;
          if (prev.length) {
            await sql`
              update order_items
              set qty = ${toNumber(prev[0].qty) + qty}, price = ${price}
              where id = ${prev[0].id}
            `;
          } else {
            await sql`
              insert into order_items (order_id, product_id, qty, price)
              values (${o.id}, ${productId}, ${qty}, ${price})
            `;
          }
        }

        // recompute totals
        const [{ subtotal }] = await sql`
          select coalesce(sum(qty * price), 0) as subtotal
          from order_items
          where order_id = ${o.id}
        `;

        // ✅ Only overwrite delivery fee if the client explicitly sends a value
        const fee =
          (deliveryFee === undefined || deliveryFee === null)
            ? Number(o.deliveryFee ?? 0)
            : Number(deliveryFee);

        const newNotes = o.notes ? (notes ? `${o.notes} | ${notes}` : o.notes) : (notes || "");

        await sql`
          update orders
          set subtotal     = ${subtotal},
              delivery_fee = ${fee},
              total        = ${Number(subtotal) + Number(fee)},
              notes        = ${newNotes}
          where id = ${o.id}
        `;

        const [updated] = await sql`
          select id, date, customer_id as "customerId", subtotal, delivery_fee as "deliveryFee", total, notes, order_code as "orderCode"
          from orders where id = ${o.id}
        `;
        return ok(updated, 201);
      }

      // create a brand new order
      const [{ count }] = await sql`
        select count(*)::int as count
        from orders
        where date = ${date}
      `;
      const seq = Number(count) + 1;
      const orderCode = `${ddmmyy(date)}_${seq}`;

      const initialFee = toNumber(deliveryFee); // new orders can default to 0

      const [created] = await sql`
        insert into orders (date, customer_id, subtotal, delivery_fee, total, notes, order_code)
        values (${date}, ${customerId}, 0, ${initialFee}, 0, ${notes}, ${orderCode})
        returning id, date, customer_id as "customerId", subtotal, delivery_fee as "deliveryFee", total, notes, order_code as "orderCode"
      `;

      for (const it of items) {
        await sql`
          insert into order_items (order_id, product_id, qty, price)
          values (${created.id}, ${Number(it.productId)}, ${toNumber(it.qty)}, ${toNumber(it.price)})
        `;
      }

      const [{ subtotal }] = await sql`
        select coalesce(sum(qty * price), 0) as subtotal
        from order_items where order_id = ${created.id}
      `;
      const total = Number(subtotal) + Number(initialFee || 0);
      await sql`
        update orders
        set subtotal = ${subtotal}, total = ${total}
        where id = ${created.id}
      `;

      const [final] = await sql`
        select id, date, customer_id as "customerId", subtotal, delivery_fee as "deliveryFee", total, notes, order_code as "orderCode"
        from orders where id = ${created.id}
      `;
      return ok(final, 201);
    }

    // -------- PUT: replace order header + items (full edit) --------
    if (httpMethod === "PUT") {
      const body = JSON.parse(event.body || "{}");
      const { id, date, customerId, deliveryFee = 0, notes = "", items = [] } = body;

      if (!id) return err(400, "id is required");
      if (!date) return err(400, "date is required");
      if (!customerId) return err(400, "customerId is required");

      await sql`
        update orders
        set date = ${date},
            customer_id = ${customerId},
            delivery_fee = ${toNumber(deliveryFee)},
            notes = ${notes}
        where id = ${id}
      `;

      await sql`delete from order_items where order_id = ${id}`;
      for (const it of items) {
        await sql`
          insert into order_items (order_id, product_id, qty, price)
          values (${id}, ${Number(it.productId)}, ${toNumber(it.qty)}, ${toNumber(it.price)})
        `;
      }

      const [{ subtotal }] = await sql`
        select coalesce(sum(qty * price), 0) as subtotal
        from order_items where order_id = ${id}
      `;
      const total = Number(subtotal) + Number(deliveryFee || 0);
      await sql`update orders set subtotal = ${subtotal}, total = ${total} where id = ${id}`;

      return ok({ updated: true });
    }

    // -------- DELETE: remove order (items cascade in DB) --------
    if (httpMethod === "DELETE") {
      const id = Number(queryStringParameters?.id);
      if (!id) return err(400, "id query param is required");
      await sql`delete from orders where id = ${id}`;
      return ok({ deleted: true });
    }

    return err(405, "Method Not Allowed");
  } catch (e) {
    return err(500, { error: e.message || "Server error" });
  }
};
