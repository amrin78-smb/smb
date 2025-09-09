import React, { useState } from "react";
import Products from "./components/Products";
import Customers from "./components/Customers";
import Orders from "./components/Orders";
import Settings from "./components/Settings";
import Insights from "./components/Insights";
import Daily from "./components/Daily";
import Login from "./components/Login";

/* ---------- Shared UI bits ---------- */
const Button = ({ children, className = "", ...props }) => (
  <button
    className={`px-3 py-2 rounded-xl border shadow-sm hover:shadow transition text-sm bg-gray-50 ${className}`}
    {...props}
  >
    {children}
  </button>
);

/* ---------- Tabs (Dashboard removed) ---------- */
const Tabs = {
  ORDERS: "Orders",
  DAILY: "Daily Orders", // default landing tab
  PRODUCTS: "Products",
  CUSTOMERS: "Customers",
  SETTINGS: "Settings",
  INSIGHTS: "Insights",
};

/* ---------- App ---------- */
export default function App() {
  // Default tab changed to Daily Orders
  const [tab, setTab] = useState(Tabs.DAILY);

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
