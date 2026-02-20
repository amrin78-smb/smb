// netlify/functions/orders-get.js
import { neon } from "@netlify/neon";
import { requireAuth, corsHeaders } from "./auth.js";

const sql = neon();

export async function handler(event) {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,OPTIONS",
          "access-control-allow-headers": "content-type,authorization",
        },
        body: "",
      };
    }

    // Verify JWT on every non-OPTIONS request
    const authErr = await requireAuth(event);
    if (authErr) return authErr;

    const id = event.queryStringParameters?.id;
    if (!id) {
      return { statusCode: 400, body: "id required" };
    }

    // Fetch order + customer details (adjust column names if yours differ)
    const rows = await sql`
      SELECT 
        o.id,
        o.order_code,                  -- rename to your actual column if different
        o.date,
        o.customer_id,
        c.name     AS customer_name,
        c.phone    AS customer_phone,
        c.address  AS customer_address,
        o.subtotal,
        o.delivery_fee                -- rename to "delivery" if that's your column
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ${id}
      LIMIT 1;
    `;
    const order = rows[0];
    if (!order) return { statusCode: 404, body: "Not found" };

    // Fetch order items with product names
    const items = await sql`
      SELECT 
        oi.product_id,
        p.name    AS name,
        oi.qty,
        oi.price
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ${id}
      ORDER BY oi.id;
    `;

    order.items = items;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: order.id,
        code: order.order_code ?? order.id,
        orderCode: order.order_code ?? order.id,
        date: order.date,
        customerId: order.customer_id,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        customerAddress: order.customer_address,
        subtotal: order.subtotal ?? 0,
        deliveryFee: order.delivery_fee ?? 0,
        items,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: e.message || "Server error" };
  }
}
