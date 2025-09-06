// src/App.jsx
import React, { useEffect, useState } from "react";
import { listOrdersByDate } from "./api";
import { todayStr, formatTHB } from "./utils/format";
import Products from "./components/Products";
import Customers from "./components/Customers";
import Orders from "./components/Orders";
import Invoices from "./components/Invoices";
import Settings from "./components/Settings";

const Section = ({ title, right, children }) => (
  <div className="w-full max-w-6xl mx-auto my-6 p-5 rounded-2xl shadow border bg-white">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div>{right}</div>
    </div>
    {children}
  </div>
);

const StatCard = ({ label, value }) => (
  <div className="p-4 bg-white border rounded-2xl shadow">
    <div className="text-sm text-gray-500">{label}</div>
    <div className="text-2xl font-semibold">{value}</div>
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

function Dashboard() {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const list = await listOrdersByDate(todayStr());
        setOrders(list);
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
    <div className="max-w-6xl mx-auto mt-6 grid gap-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Orders Today" value={totals.orders} />
        <StatCard label="Revenue Today" value={formatTHB(totals.revenue)} />
        <StatCard label="Date" value={todayStr()} />
      </div>

      <Section title="Today’s Orders">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-2">Order #</th>
              <th className="p-2">Customer</th>
              <th className="p-2">Subtotal</th>
              <th className="p-2">Delivery</th>
              <th className="p-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b">
                <td className="p-2">{o.orderCode}</td>
                <td className="p-2">{o.customerName ?? o.customerId}</td>
                <td className="p-2">{formatTHB(o.subtotal)}</td>
                <td className="p-2">{formatTHB(o.deliveryFee)}</td>
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
      </Section>

      <Section title="How to use">
        <ul className="list-disc pl-6 text-sm text-gray-700 space-y-1">
          <li>
            Use <b>Orders</b> to create orders. Same customer + same date is{" "}
            <b>auto-consolidated</b>.
          </li>
          <li>Manage <b>Products</b> and <b>Customers</b>.</li>
          <li>Invoices tab lets you generate a PDF invoice for any order.</li>
          <li>
            All data is stored in <b>Neon Postgres</b>, via Netlify Functions.
          </li>
          <li>
            Use <b>Settings</b> to import CSV for Products and Customers.
          </li>
        </ul>
      </Section>
    </div>
  );
}

const Tabs = {
  DASHBOARD: "Dashboard",
  ORDERS: "Orders",
  PRODUCTS: "Products",
  CUSTOMERS: "Customers",
  INVOICES: "Invoices",
  SETTINGS: "Settings",
};

export default function App() {
  const [tab, setTab] = useState(Tabs.DASHBOARD);

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="font-bold text-lg">
            Selera Malaysia Bangkok Inventory and Ordering Portal
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex gap-2">
              {Object.values(Tabs).map((t) => (
                <Button
                  key={t}
                  className={tab === t ? "bg-blue-100" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </Button>
              ))}
            </nav>
            <img src="/logo.png" alt="Selera Malaysia Bangkok" className="h-10" />
          </div>
        </div>
      </header>

      <main className="px-5 pb-10">
        {tab === Tabs.DASHBOARD && <Dashboard />}
        {tab === Tabs.ORDERS && <Orders />}
        {tab === Tabs.PRODUCTS && <Products />}
        {tab === Tabs.CUSTOMERS && <Customers />}
        {tab === Tabs.INVOICES && <Invoices />}
        {tab === Tabs.SETTINGS && <Settings />}
      </main>

      <style>{`table { border-collapse: collapse; } th, td { border-color: #e5e7eb; }`}</style>
    </div>
  );
}
