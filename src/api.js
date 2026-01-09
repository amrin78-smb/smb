// src/api.js
// Thin client for Netlify Functions.
// NOTE: Authentication is NOT implemented yet; do not expose this app publicly until protected.

const base = "/.netlify/functions";

async function request(method, url, data) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${method} ${url} failed`);
  }

  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

/* Products */
export const listProducts   = () => request("GET", "/products");
export const createProduct  = (p) => request("POST", "/products", p);
export const updateProduct  = (p) => request("PUT", "/products", p);
export const deleteProduct  = (id) => request("DELETE", `/products?id=${encodeURIComponent(id)}`);

/* Customers */
export const listCustomers  = () => request("GET", "/customers");
export const createCustomer = (c) => request("POST", "/customers", c);
export const updateCustomer = (c) => request("PUT", "/customers", c);
export const deleteCustomer = (id) => request("DELETE", `/customers?id=${encodeURIComponent(id)}`);

/* Orders */
export const listMonths          = () => request("GET", "/orders?months=1");
export const listDaysInMonth     = (ym) => request("GET", `/orders?days=${encodeURIComponent(ym)}`);      // ym = "YYYY-MM"
export const listOrdersByDate    = (date) => request("GET", `/orders?date=${encodeURIComponent(date)}`);  // date = "YYYY-MM-DD"
export const createOrMergeOrder  = (o) => request("POST", "/orders", o);                                  // {date,customerId,deliveryFee,notes,items[]}
export const updateOrderAndItems = (o) => request("PUT", "/orders", o);                                   // {id,date,customerId,deliveryFee,notes,items[]}
export const deleteOrder         = (id) => request("DELETE", `/orders?id=${encodeURIComponent(id)}`);

// Get a single order (with items) — used for invoices
export const getOrder            = (id) => request("GET", `/orders-get?id=${encodeURIComponent(id)}`);

/* Insights */
export const getInsightsSummary = ({ dateFrom, dateTo } = {}) =>
  request("POST", "/insights", { action: "summary", dateFrom, dateTo });

export const getCustomerInsights = (customerId, { dateFrom, dateTo } = {}) =>
  request("POST", "/insights", { action: "customer", customerId, dateFrom, dateTo });
