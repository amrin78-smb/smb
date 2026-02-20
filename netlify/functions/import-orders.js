// netlify/functions/import-orders.js
import { neon } from "@neondatabase/serverless";
import { requireAuth, corsHeaders } from "./auth.js";

const sql = neon(process.env.NETLIFY_DATABASE_URL);

const ok = (data) => ({
  statusCode: 200,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  body: JSON.stringify(data),
});
const err = (status, msg) => ({
  statusCode: status,
  headers: { "access-control-allow-origin": "*" },
  body: typeof msg === "string" ? msg : JSON.stringify(msg),
});
const toNumber = (v) => (v == null || v === "" ? 0 : Number(v));

export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST,OPTIONS",
          "access-control-allow-headers": "content-type,authorization",
        },
        body: "",
      };
    }
    // Verify JWT on every non-OPTIONS request
    const authErr = await requireAuth(event);
    if (authErr) return authErr;

    if (event.httpMethod !== "POST") return err(405, "Method Not Allowed");

    const rows = JSON.parse(event.body || "[]");
    if (!Array.isArray(rows) || rows.length === 0) return err(400, "No rows provided");

    // Caches
    const customerIdByName = new Map();
    const productIdByName = new Map();
    const orderIdByKey = new Map(); // key = `${date}|${customerId}`

    // Helpers
    const getCustomerId = async ({ name, phone, address }) => {
      const key = name.trim();
      if (customerIdByName.has(key)) return customerIdByName.get(key);

      const found = await sql`select id, phone, address from customers where name = ${key} limit 1`;
      let id;
      if (found.length) {
        id = found[0].id;
        // optional: backfill phone/address if empty in DB and provided in CSV
        const needsPhone = !found[0].phone && phone;
        const needsAddr = !found[0].address && address;
        if (needsPhone || needsAddr) {
          await sql`
            update customers
            set phone = coalesce(nullif(${phone}, ''), phone),
                address = coalesce(nullif(${address}, ''), address)
            where id = ${id}
          `;
        }
      } else {
        const inserted = await sql`
          insert into customers (name, phone, address, grabwin, grabcar, nationality)
          values (${key}, ${phone || ""}, ${address || ""}, '', '', '')
          returning id
        `;
        id = inserted[0].id;
      }
      customerIdByName.set(key, id);
      return id;
    };

    const getProductId = async (name) => {
      const key = name.trim();
      if (productIdByName.has(key)) return productIdByName.get(key);
      const found = await sql`select id from products where name = ${key} limit 1`;
      let id;
      if (found.length) {
        id = found[0].id;
      } else {
        const ins = await sql`insert into products (name, price) values (${key}, 0) returning id`;
        id = ins[0].id;
      }
      productIdByName.set(key, id);
      return id;
    };

    // Group CSV rows by order (date + customerName)
    const groups = new Map();
    for (const r of rows) {
      const date = String(r.date || "").slice(0, 10);
      const customerName = String(r.customerName || "").trim();
      if (!date || !customerName) continue;

      const key = `${date}||${customerName}`;
      if (!groups.has(key)) {
        groups.set(key, {
          date,
          customerName,
          customerPhone: r.customerPhone || "",
          customerAddress: r.customerAddress || "",
          deliveryFee: toNumber(r.deliveryFee),
          notes: r.notes || "",
          items: [],
        });
      }
      groups.get(key).items.push({
        productName: String(r.productName || "").trim(),
        qty: toNumber(r.qty),
        price: toNumber(r.price), // unit price
      });
    }

    let created = 0, merged = 0, itemsInserted = 0;

    // Process each order group
    for (const [, g] of groups) {
      const customerId = await getCustomerId({
        name: g.customerName,
        phone: g.customerPhone,
        address: g.customerAddress,
      });

      const orderKey = `${g.date}|${customerId}`;
      let orderId = orderIdByKey.get(orderKey);

      if (!orderId) {
        // If order exists for same (date, customer) consolidate into it, else create
        const existing = await sql`
          select id, delivery_fee, notes
          from orders
          where date = ${g.date} and customer_id = ${customerId}
          limit 1
        `;
        if (existing.length) {
          orderId = existing[0].id;
          // Only overwrite delivery fee/notes if provided
          const newFee = g.deliveryFee != null ? toNumber(g.deliveryFee) : existing[0].delivery_fee || 0;
          const newNotes = g.notes
            ? (existing[0].notes ? `${existing[0].notes} | ${g.notes}` : g.notes)
            : existing[0].notes || "";
          await sql`
            update orders
            set delivery_fee = ${newFee},
                notes = ${newNotes}
            where id = ${orderId}
          `;
          merged++;
        } else {
          // Generate order_code seq for that date
          const [{ count }] = await sql`
            select count(*)::int as count from orders where date = ${g.date}
          `;
          const seq = Number(count) + 1;
          const ddmmyy = `${g.date.slice(8,10)}${g.date.slice(5,7)}${g.date.slice(2,4)}`;
          const orderCode = `${ddmmyy}_${seq}`;

          const ins = await sql`
            insert into orders (date, customer_id, subtotal, delivery_fee, total, notes, order_code)
            values (${g.date}, ${customerId}, 0, ${toNumber(g.deliveryFee)}, 0, ${g.notes || ""}, ${orderCode})
            returning id
          `;
          orderId = ins[0].id;
          created++;
        }
        orderIdByKey.set(orderKey, orderId);
      }

      // Insert items (merge by product: add qty and last price)
      for (const it of g.items) {
        const productId = await getProductId(it.productName);
        // check if an item already exists for that product
        const prev = await sql`
          select id, qty from order_items where order_id = ${orderId} and product_id = ${productId} limit 1
        `;
        if (prev.length) {
          await sql`
            update order_items
            set qty = ${prev[0].qty + toNumber(it.qty)}, price = ${toNumber(it.price)}
            where id = ${prev[0].id}
          `;
        } else {
          await sql`
            insert into order_items (order_id, product_id, qty, price)
            values (${orderId}, ${productId}, ${toNumber(it.qty)}, ${toNumber(it.price)})
          `;
        }
        itemsInserted++;
      }

      // Recompute subtotal + total
      const [{ subtotal }] = await sql`
        select coalesce(sum(qty * price), 0) as subtotal
        from order_items where order_id = ${orderId}
      `;
      const [{ delivery_fee }] = await sql`
        select delivery_fee from orders where id = ${orderId}
      `;
      await sql`
        update orders
        set subtotal = ${subtotal}, total = ${Number(subtotal) + Number(delivery_fee || 0)}
        where id = ${orderId}
      `;
    }

    return ok({ created, merged, itemsInserted, ordersProcessed: groups.size });
  } catch (e) {
    return err(500, { error: e.message || "Server error" });
  }
};
