// src/api.js
// Thin client for Netlify Functions.
// Attaches the JWT from sessionStorage to every request as Authorization: Bearer <token>.
// On 401, fires a custom "smb:logout" event so App.jsx can force the user back to login.

const base = "/.netlify/functions";

function getToken() {
  try {
    return sessionStorage.getItem("smb_token") || "";
  } catch {
    return "";
  }
}

async function request(method, url, data) {
  const token = getToken();
  const headers = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(`${base}${url}`, {
    method,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });

  if (res.status === 401) {
    // Token expired or invalid — clear storage and signal the app to log out
    try {
      sessionStorage.removeItem("smb_token");
      sessionStorage.removeItem("smb_user");
    } catch {}
    window.dispatchEvent(new CustomEvent("smb:logout", { detail: "session_expired" }));
    throw new Error("Session expired. Please log in again.");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${method} ${url} failed`);
  }

  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

/* Auth */
export async function login(username, password) {
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok) {
    try {
      sessionStorage.setItem("smb_token", data.token);
      sessionStorage.setItem("smb_user", data.user);
    } catch {}
  }
  return { ok: res.ok && data.ok, user: data.user, error: data.error };
}

export function logout() {
  try {
    sessionStorage.removeItem("smb_token");
    sessionStorage.removeItem("smb_user");
  } catch {}
}

export function getSavedUser() {
  try {
    return sessionStorage.getItem("smb_user") || null;
  } catch {
    return null;
  }
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
export const listDaysInMonth     = (ym) => request("GET", `/orders?days=${encodeURIComponent(ym)}`);
export const listOrdersByDate    = (date) => request("GET", `/orders?date=${encodeURIComponent(date)}`);
export const createOrMergeOrder  = (o) => request("POST", "/orders", o);
export const updateOrderAndItems = (o) => request("PUT", "/orders", o);
export const deleteOrder         = (id) => request("DELETE", `/orders?id=${encodeURIComponent(id)}`);
export const getOrder            = (id) => request("GET", `/orders-get?id=${encodeURIComponent(id)}`);

/* Insights */
export const getInsightsSummary = ({ dateFrom, dateTo } = {}) =>
  request("POST", "/insights", { action: "summary", dateFrom, dateTo });

export const getCustomerInsights = (customerId, { dateFrom, dateTo } = {}) =>
  request("POST", "/insights", { action: "customer", customerId, dateFrom, dateTo });
