import React, { useEffect, useMemo, useState } from "react";
import { listOrdersByDate, listCustomers } from "../api";
import { todayStr, formatTHB, formatDateDMY } from "../utils/format";

/* ---------- Small UI helpers ---------- */
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

/** Group items across all orders by product */
function groupItemsByProduct(dayOrders) {
  const map = new Map();
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

/** Group orders by customerId */
function groupOrdersByCustomer(dayOrders) {
  const map = new Map();
  for (const o of dayOrders) {
    const cid = o.customerId ?? 0;
    const arr = map.get(cid) || [];
    arr.push(o);
    map.set(cid, arr);
  }
  return map;
}

export default function Daily() {
  const [date, setDate] = useState(todayStr());
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState([]);

  async function load() {
    setLoading(true);
    try {
      const [os, cs] = await Promise.all([
        listOrdersByDate(date),
        listCustomers(),
      ]);
      setOrders(Array.isArray(os) ? os : []);
      setCustomers(Array.isArray(cs) ? cs : []);
    } catch (e) {
      console.error(e);
      setOrders([]);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { if (date) load(); }, [date]);

  const customersMap = useMemo(
    () => Object.fromEntries(customers.map(c => [c.id, c])),
    [customers]
  );

  const dayItemTotals = useMemo(() => groupItemsByProduct(orders), [orders]);
  const byCustomer    = useMemo(() => groupOrdersByCustomer(orders), [orders]);

  const daySubtotal = useMemo(() => orders.reduce((s,o)=>s+Number(o.subtotal||0),0), [orders]);
  const dayDelivery = useMemo(() => orders.reduce((s,o)=>s+Number(o.deliveryFee||0),0), [orders]);
  const dayGrand    = useMemo(() => orders.reduce((s,o)=>s+Number(o.total||0),0), [orders]);

  return (
    <div className="max-w-6xl mx-auto">
      {/* ONE combined section for totals + items */}
      <Section
        title="Daily Orders"
        right={
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <Input type="date" value={date} onChange={(e)=>setDate(e.target.value)} />
            <Button onClick={load} disabled={loading}>{loading ? "Loading..." : "Refresh"}</Button>
          </div>
        }
      >
        {/* Totals inline (no inner card) */}
        <div className="mb-3">
          <div className="text-sm text-gray-600">Total for {formatDateDMY(date)}</div>
          <div className="text-xl font-semibold">{formatTHB(dayGrand)}</div>
          <div className="text-xs text-gray-600">
            Subtotal {formatTHB(daySubtotal)} • Delivery {formatTHB(dayDelivery)}
          </div>
        </div>

        {/* Items table directly below totals */}
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="p-2">Food Item</th>
                <th className="p-2">Total Quantity</th>
                <th className="p-2">Total Amount</th>
              </tr>
            </thead>
            <tbody>
              {dayItemTotals.map((row, i) => (
                <tr key={i} className="border-b">
                  <td className="p-2">{row.name}</td>
                  <td className="p-2">{row.qty}</td>
                  <td className="p-2">{formatTHB(row.amount)}</td>
                </tr>
              ))}
              {dayItemTotals.length === 0 && (
                <tr><td colSpan={3} className="p-2 text-gray-500">No items.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Customers for the day (separate section by design) */}
      <Section title="Customers for the day">
        {[...byCustomer.entries()].map(([customerId, list]) => {
          const itemsMap = new Map();
          let deliveryTotal = 0;
          for (const o of list) {
            deliveryTotal += Number(o.deliveryFee || 0);
            for (const it of (o.items || [])) {
              const key = String(it.productId ?? it.productName ?? "");
              const prev = itemsMap.get(key) || { name: it.productName || "Unknown", qty: 0, amount: 0 };
              const qty = Number(it.qty || 0);
              const amt = qty * Number(it.price || 0);
              prev.qty += qty;
              prev.amount += amt;
              itemsMap.set(key, prev);
            }
          }
          const rows = Array.from(itemsMap.values());
          const lineTotal = rows.reduce((s,r)=>s+Number(r.amount||0),0);
          const grand = lineTotal + deliveryTotal;

          const c = customersMap[customerId] || {};
          const displayName = c?.name ?? (list[0]?.customerName ?? `Customer ${customerId || ""}`);

          return (
            <div key={customerId || displayName} className="mb-4 sm:mb-6">
              <div className="p-4 rounded-xl border bg-white">
                <div className="text-base sm:text-lg font-semibold mb-1">{displayName}</div>
                <div className="text-sm text-gray-700 mb-3">
                  <div><span className="font-medium">Phone:</span> {c?.phone || "—"}</div>
                  <div><span className="font-medium">Address:</span> {c?.address || "—"}</div>
                </div>
                <div className="overflow-x-auto -mx-2 sm:mx-0 px-2 sm:px-0">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="p-2">Item</th>
                        <th className="p-2" style={{ width: 100 }}>Quantity</th>
                        <th className="p-2" style={{ width: 160 }}>Total Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="p-2">{r.name}</td>
                          <td className="p-2">{r.qty}</td>
                          <td className="p-2">{formatTHB(r.amount)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="p-2">Delivery Fee</td>
                        <td className="p-2">—</td>
                        <td className="p-2">{formatTHB(deliveryTotal)}</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-semibold">Total:</td>
                        <td className="p-2 font-semibold">{rows.reduce((s,r)=>s+Number(r.qty||0),0)}</td>
                        <td className="p-2 font-semibold">{formatTHB(grand)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })}
        {byCustomer.size === 0 && <div className="text-gray-500">No customers.</div>}
      </Section>
    </div>
  );
}
