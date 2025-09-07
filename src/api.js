// src/api.js
const base = "/.netlify/functions";

async function j(method, url, data) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${method} ${url} failed`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

/* Products */
export const listProducts   = () => j("GET",  "/products");
export const createProduct  = (p) => j("POST", "/products", p);
export const updateProduct  = (p) => j("PUT",  "/products", p);
export const deleteProduct  = (id) => j("DELETE", `/products?id=${id}`);

// ---------- Insights (aggregates) ----------
export const getInsightsSummary = (params) => j("POST", "/insights", { action: "summary", ...params });
export const getCustomerInsights = (customerId, params) => j("POST", "/insights", { action: "customer", customerId, ...params });

/* Customers */
export const listCustomers  = () => j("GET",  "/customers");
export const createCustomer = (c) => j("POST", "/customers", c);
export const updateCustomer = (c) => j("PUT",  "/customers", c);
export const deleteCustomer = (id) => j("DELETE", `/customers?id=${id}`);

/* Orders */
export const listRecentOrders    = () => j("GET",  "/orders");
export const listMonths          = () => j("GET",  "/orders?months=1");
export const listDaysInMonth     = (ym) => j("GET", `/orders?days=${ym}`);          // ym = "YYYY-MM"
export const listOrdersByDate    = (date) => j("GET", `/orders?date=${date}`);      // date = "YYYY-MM-DD"
export const createOrMergeOrder  = (o) => j("POST", "/orders", o);                  // {date,customerId,deliveryFee,notes,items[]}
export const updateOrderAndItems = (o) => j("PUT",  "/orders", o);                  // {id,date,customerId,deliveryFee,notes,items[]}
export const deleteOrder         = (id) => j("DELETE", `/orders?id=${id}`);

// ➕ NEW: Get a single order (with items) — used in Invoices.jsx
export const getOrder            = (id) => j("GET", `/orders-get?id=${id}`);
