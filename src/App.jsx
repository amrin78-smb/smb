import React, { useEffect, useState } from "react";
import { listOrdersByDate } from "./api";
import { todayStr, formatTHB, formatDateDMY } from "./utils/format";
import Products from "./components/Products";
import Customers from "./components/Customers";
import Orders from "./components/Orders";
import Settings from "./components/Settings";
import Insights from "./components/Insights";
import Daily from "./components/Daily";
import Login from "./components/Login";

/* ---------- Shared UI bits ---------- */
const Section = ({ title, right, children }) => (
  <div className="w-full max-w-6xl mx-auto my-4 sm:my-6 p-4 sm:p-5 rounded-2xl shadow border bg-white">
    <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
      <h2 className="text-lg sm:text-xl font-semibold">{title}</h2>
      <div className="min-w-0">{right}</div>
    </div>
    {children}
  </div>
);

const StatCard = ({ label, value }) => (
  <div className="p-3 sm:p-4 bg-white border rounded-2xl shadow">
    <div className="text-xs sm:text-sm text-gray-500">{label}</div>
    <div className="text-xl sm:text-2xl font-semibold">{value}</div>
  </div>
);

const Button = ({ children, className = "", ...props }) => (
  <button
    className={`px-3 py-2 rounded-xl border shadow-sm hover:shadow transition text-sm bg-gray-50 ${className}`}
    {...props}
  >
    {children}
  </button>
);

/* ---------- Dashboard ---------- */
function Dashboard() {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const list = await listOrdersByDate(todayStr());
        setOrders(list || []);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const totals = React.useMemo(() => {
    let revenue = 0;
    orders.forEach((o) => (revenue += Number(o.total || 0)));
    return { orders: orders.length, revenue };
  }, [orders]);

  return (
    <div className="max-w-6xl mx-auto mt-4 sm:mt-6 grid gap-4 sm:gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <StatCard label="Orders Today" value={totals.orders} />
        <StatCard label="Revenue Today" value={formatTHB(totals.revenue)} />
        <StatCard label="Date" value={formatDateDMY(todayStr())} />
      </div>

      <Section title="Today’s Orders">
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2 text-left">Order #</th>
                <th className="p-2 text-left hidden sm:table-cell">Customer</th>
                <th className="p-2 text-left">Subtotal</th>
                <th className="p-2 text-left hidden sm:table-cell">Delivery</th>
                <th className="p-2 text-left">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b">
                  <td className="p-2">{o.orderCode}</td>
                  <td className="p-2 hidden sm:table-cell">
                    {o.customerName ?? o.customerId}
                  </td>
                  <td className="p-2">{formatTHB(o.subtotal)}</td>
                  <td className="p-2 hidden sm:table-cell">
                    {formatTHB(o.deliveryFee)}
                  </td>
                  <td className="p-2">{formatTHB(o.total)}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-2 text-gray-500">
                    No orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="How to use">
        <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
          <li>
            Use <b>Orders</b> to create orders. Same customer + same date is{" "}
            <b>auto-consolidated</b>.
          </li>
          <li>
            Manage <b>Products</b> and <b>Customers</b>.
          </li>
          <li>
            Data is stored in <b>Neon Postgres</b> (via Netlify Functions).
          </li>
          <li>
            Use <b>Settings</b> to import CSV for Products and Customers.
          </li>
          <li>
            Use <b>Insights</b> for monthly totals, top items/customers, and
            per-customer history.
          </li>
          <li>
            Use <b>Daily Orders</b> for a one-page day view (totals per item and
            per-customer blocks).
          </li>
        </ul>
      </Section>
    </div>
  );
}

/* ---------- Tabs ---------- */
const Tabs = {
  DASHBOARD: "Dashboard",
  ORDERS: "Orders",
  DAILY: "Daily Orders",   // placed next to Orders
  PRODUCTS: "Products",
  CUSTOMERS: "Customers",
  SETTINGS: "Settings",
  INSIGHTS: "Insights",
};

/* ---------- App ---------- */
export default function App() {
  const [tab, setTab] = useState(Tabs.DASHBOARD);
  const [user, setUser] = useState(() => {
    try {
      return localStorage.getItem("smb_user") || null;
    } catch {
      return null;
    }
  });

  const handleLogin = (username) => {
    try {
      localStorage.setItem("smb_user", username || "user");
    } catch {}
    setUser(username || "user");
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem("smb_user");
    } catch {}
    setUser(null);
  };

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-3 sm:px-5 py-2.5 sm:py-3">
          {/* Row: title + right controls */}
          <div className="flex items-center justify-between gap-3">
            <div className="font-bold text-base sm:text-lg leading-tight">
              Selera Malaysia Bangkok Inventory and Ordering Portal
            </div>
            <div className="flex items-center gap-2">
              <img
                src="/logo.png"
                alt="Selera Malaysia Bangkok"
                className="h-8 sm:h-10 shrink-0"
              />
              <button
                onClick={handleLogout}
                className="px-2 py-1 text-xs sm:text-sm rounded-lg border bg-gray-50 hover:shadow"
                title="Logout"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Row: tabs/nav */}
          <nav className="mt-2 flex gap-2 overflow-x-auto whitespace-nowrap no-scrollbar">
            {Object.values(Tabs).map((t) => (
              <Button
                key={t}
                className={`shrink-0 ${tab === t ? "bg-blue-100" : ""}`}
                onClick={() => setTab(t)}
              >
                {t}
              </Button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="px-3 sm:px-5 pb-20 sm:pb-10">
        {tab === Tabs.DASHBOARD && <Dashboard />}
        {tab === Tabs.ORDERS && <Orders />}
        {tab === Tabs.DAILY && <Daily />}
        {tab === Tabs.PRODUCTS && <Products />}
        {tab === Tabs.CUSTOMERS && <Customers />}
        {tab === Tabs.SETTINGS && <Settings />}
        {tab === Tabs.INSIGHTS && <Insights />}
      </main>

      {/* Small helpers */}
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        table { border-collapse: collapse; }
        th, td { border-color: #e5e7eb; }
      `}</style>
    </div>
  );
}
