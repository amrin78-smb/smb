// src/api.js
// Thin client for Netlify Functions.
//
// Auth: after login, the app stores the user in localStorage key "smb_user".
// This client forwards it to Netlify Functions via the "x-smb-user" header.

const base = "/.netlify/functions";

function authHeaders() {
  const user = localStorage.getItem("smb_user");
  return user ? { "x-smb-user": user } : {};
}

async function request(method, url, data) {
  const headers = {
    "content-type": "application/json",
    ...authHeaders(),
  };

  const res = await fetch(`${base}${url}`, {
    method,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${method} ${url} failed`);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

/* Products */
export const listProducts  = () => request("GET", "/products");
export const createProduct = (p) => request("POST", "/products", p);
export const updateProduct = (p) => request("PUT", "/products", p);
export const deleteProduct = (id) => request("DELETE", `/products?id=${encodeURIComponent(id)}`);

/* Customers */
export const listCustomers  = () => request("GET", "/customers");
export const createCustomer = (c) => request("POST", "/customers", c);
export const updateCustomer = (c) => request("PUT", "/customers", c);
export const deleteCustomer = (id) => request("DELETE", `/customers?id=${encodeURIComponent(id)}`);

/* Orders */
export const listMonths          = () => request("GET", "/orders?months=1");
export const listDaysInMonth     = (ym) => request("GET", `/orders?days=${encodeURIComponent(ym)}`); // ym = "YYYY-MM"
export const listOrdersByDate    = (date) => request("GET", `/orders?date=${encodeURIComponent(date)}`); // date = "YYYY-MM-DD"
export const createOrMergeOrder  = (o) => request("POST", "/orders", o); // {date,customerId,deliveryFee,notes,items[]}
export const updateOrderAndItems = (o) => request("PUT", "/orders", o);  // {id,date,customerId,deliveryFee,notes,items[]}
export const deleteOrder         = (id) => request("DELETE", `/orders?id=${encodeURIComponent(id)}`);

// Get a single order (with items) — used for invoices (if needed)
export const getOrder            = (id) => request("GET", `/orders-get?id=${encodeURIComponent(id)}`);

/* Insights */
export const getInsightsSummary = ({ dateFrom, dateTo } = {}) =>
  request("POST", "/insights", { action: "summary", dateFrom, dateTo });

export const getCustomerInsights = (customerId, { dateFrom, dateTo } = {}) =>
  request("POST", "/insights", { action: "customer", customerId, dateFrom, dateTo });
