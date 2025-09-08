import React, { useEffect, useMemo, useState } from "react";
import { listOrdersByDate } from "../api";
import { todayStr, formatTHB, formatDateDMY } from "../utils/format";

/* Small UI helpers (same look & feel as rest of app) */
const Section = ({ title, right, children }) => (
  <div className="w-full max-w-6xl mx-auto my-4 sm:my-6 p-4 sm:p-5 rounded-2xl shadow border bg-white">
    <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
      <h2 className="text-lg sm:text-xl font-semibold">{title}</h2>
      <div className="min-w-0">{right}</div>
    </div>
    {children}
  </div>
);
const Input = ({ className = "", ...props }) => (
  <input className={`px-3 py-2 rounded-xl border w-full focus:outline-none focus:ring ${className}`} {...props} />
);
const Button = ({ className = "", ...props }) => (
  <button className={`px-3 py-2 rounded-xl border shadow-sm hover:shadow transition text-sm bg-gray-50 ${className}`} {...props} />
);

/** Group helpers */
function groupItemsByProduct(dayOrders) {
  const map = new Map(); // key: productName|productId
  for (const o of dayOrders) {
    for (const it of (o.items || [])) {
      const key = String(it.productId ?? it.productName ?? "");
      const name = it.productName || "Unknown item";
      const qty = Number(it.qty || 0);
      const amt = qty * Number(it.price || 0);
      const prev = map.get(key) || { name, qty: 0, amount: 0 };
      prev.qty += qty;
      prev.amount += amt;
      map.set(key, prev);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
}

export default function Daily() {
  const [date, setDate] = useState(todayStr());         // stays ISO for the input & API
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const list = await listOrdersByDate(date);
      setOrders(list || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);        // initial load
  useEffect(() => { if (date) load(); }, [date]); // reload on date change

  const dayItemTotals = useMemo(() => groupItemsByProduct(orders), [orders]);

  const daySubtotal = useMemo(() => orders.reduce((s,o)=>s+Number(o.subtotal||0),0), [orders]);
  const dayDelivery = useMemo(() => orders.reduce((s,o)=>s+Number(o.deliveryFee||0),0), [orders]);
  const dayGrand    = useMemo(() => orders.reduce((s,o)=>s+Number(o.total||0),0), [orders]);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header controls */}
      <Section
        title="Daily Summary"
        right={
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <Input type="date" value={date} onChange={(e)=>setDate(e.target.value)} />
            <Button onClick={load} disabled={loading}>{loading ? "Loading..." : "Refresh"}</Button>
          </div>
        }
      >
        {/* Quick stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border bg-gray-50">
            <div className="text-sm text-gray-600">Date</div>
            <div className="text-xl font-semibold">{formatDateDMY(date)}</div>
          </div>
          <div className="p-4 rounded-xl border bg-gray-50">
            <div className="text-sm text-gray-600">Orders</div>
            <div className="text-xl font-semibold">{orders.length}</div>
          </div>
          <div className="p-4 rounded-xl border bg-gray-50">
            <div className="text-sm text-gray-600">Total</div>
            <div className="text-xl font-semibold">{formatTHB(dayGrand)}</div>
            <div className="text-xs text-gray-500 mt-1">
              Subtotal {formatTHB(daySubtotal)} • Delivery {formatTHB(dayDelivery)}
            </div>
          </div>
        </div>
      </Section>

      {/* Items total (like the right table in your Excel) */}
      <Section title={`Items for ${formatDateDMY(date)}`}>
        {dayItemTotals.length === 0 ? (
          <div className="text-sm text-gray-500">No items on this day.</div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Food Item</th>
                  <th className="py-2 pr-4">Total Quantity</th>
                  <th className="py-2 pr-4 hidden sm:table-cell">Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {dayItemTotals.map((it, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-4">{it.name}</td>
                    <td className="py-2 pr-4 font-semibold">{it.qty}</td>
                    <td className="py-2 pr-4 hidden sm:table-cell">{formatTHB(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Per-customer blocks (like the left side of your Excel) */}
      <Section title="Customers for the day">
        {orders.length === 0 ? (
          <div className="text-sm text-gray-500">No orders on this day.</div>
        ) : (
          <div className="space-y-4">
            {orders.map((o) => (
              <div key={o.id} className="rounded-xl border bg-white overflow-hidden">
                <div className="px-4 py-2 border-b bg-gray-50">
                  <div className="font-semibold">{o.customerName ?? o.customerId}</div>
                </div>
                <div className="p-4">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-2 pr-4">Item</th>
                          <th className="py-2 pr-4">Quantity</th>
                          <th className="py-2 pr-4 hidden sm:table-cell">Total Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(o.items || []).map((it, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2 pr-4">{it.productName}</td>
                            <td className="py-2 pr-4">{it.qty}</td>
                            <td className="py-2 pr-4 hidden sm:table-cell">{formatTHB(Number(it.qty||0)*Number(it.price||0))}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="py-2 pr-4 text-gray-700">Delivery Fee</td>
                          <td className="py-2 pr-4">—</td>
                          <td className="py-2 pr-4 hidden sm:table-cell">{formatTHB(o.deliveryFee || 0)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 font-semibold">Total:</td>
                          <td className="py-2 pr-4 font-semibold">
                            {(o.items || []).reduce((s, it) => s + Number(it.qty || 0), 0)}
                          </td>
                          <td className="py-2 pr-4 font-semibold hidden sm:table-cell">
                            {formatTHB(o.total || 0)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
