import React from "react";
import {
  listMonths,
  listDays,
  listOrdersByDate,
  listCustomers,
  createOrder,
  updateOrder,
  deleteOrder as apiDeleteOrder,
  getOrder,
} from "../api";
import { useFuzzy, formatTHB, formatDateDMY } from "../utils/format";

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
const Label = ({ children, className = "" }) => (
  <label className={"block text-sm text-gray-600 mb-1 " + className}>{children}</label>
);
const Input = ({ className = "", ...props }) => (
  <input className={`px-3 py-2 rounded-xl border w-full focus:outline-none focus:ring ${className}`} {...props} />
);
const Button = ({ className = "", ...props }) => (
  <button className={`px-3 py-2 rounded-xl border shadow-sm hover:shadow transition text-sm bg-gray-50 ${className}`} {...props} />
);

/* ---------- Customer typeahead (like Add item) ---------- */
function CustomerTypeahead({ customers, draft, setDraft }) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [hi, setHi] = React.useState(0);

  const base = React.useMemo(() => {
    const list = Array.isArray(customers) ? customers : [];
    return list.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "en", { sensitivity: "base" }));
  }, [customers]);

  const results = React.useMemo(() => {
    if (!q) return base.slice(0, 12);
    return useFuzzy(q, base, ["name", "phone", "address"]).slice(0, 12);
  }, [q, base]);

  React.useEffect(() => { if (open) setHi(0); }, [open, q]);

  function choose(c) {
    setDraft(d => ({ ...d, customerId: c.id, customerName: c.name || String(c.id || "") }));
    setQ("");
    setOpen(false);
  }

  function onKeyDown(e) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[hi]) choose(results[hi]); }
    else if (e.key === "Escape") { setOpen(false); }
  }

  const current = React.useMemo(() => (Array.isArray(customers) ? customers.find(c => c.id === draft?.customerId) : null), [customers, draft?.customerId]);

  return (
    <div className="relative">
      <Label>Customer</Label>
      <input
        className="px-3 py-2 rounded-xl border w-full focus:outline-none focus:ring"
        placeholder="Type name / phone / address…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && (q || results.length) ? (
        <div className="absolute z-40 mt-1 w-full max-h-64 overflow-auto rounded-xl border bg-white shadow">
          {results.length === 0 && <div className="px-3 py-2 text-sm text-gray-500">No matches</div>}
          {results.map((c, idx) => (
            <button
              key={c.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
              className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${idx === hi ? "bg-gray-100" : ""}`}
            >
              <div className="font-medium">{c.name || "—"}</div>
              <div className="text-xs text-gray-600">
                {c.phone || "—"}{c.address ? ` • ${c.address}` : ""}
              </div>
            </button>
          ))}
        </div>
      ) : null}
      {current && !q && (
        <div className="mt-1 text-xs text-gray-600">
          <span className="font-medium">Selected:</span> {current.name || "—"} • {current.phone || "—"}{current.address ? ` • ${current.address}` : ""}
        </div>
      )}
    </div>
  );
}

/* ---------- Page ---------- */
export default function Orders() {
  const [months, setMonths] = React.useState([]);
  const [days, setDays] = React.useState([]);
  const [selectedMonth, setSelectedMonth] = React.useState("");
  const [selectedDay, setSelectedDay] = React.useState("");
  const [customers, setCustomers] = React.useState([]);
  const [dayOrders, setDayOrders] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  // draft for create form
  const [draft, setDraft] = React.useState({ date: "", customerId: null, customerName: "" });

  const customersMap = React.useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers]);

  // Totals for selected day
  const daySubtotal = React.useMemo(() => dayOrders.reduce((s,o)=>s+Number(o.subtotal||0),0), [dayOrders]);
  const dayDelivery = React.useMemo(() => dayOrders.reduce((s,o)=>s+Number(o.deliveryFee||0),0), [dayOrders]);
  const dayGrand    = React.useMemo(() => dayOrders.reduce((s,o)=>s+Number(o.total||0),0), [dayOrders]);

  // Items aggregation
  const dayItemTotals = React.useMemo(() => {
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
  }, [dayOrders]);

  React.useEffect(() => {
    (async () => {
      try {
        const [ms, cs] = await Promise.all([listMonths(), listCustomers()]);
        setMonths(Array.isArray(ms) ? ms : []);
        setCustomers(Array.isArray(cs) ? cs : []);
        if (Array.isArray(ms) && ms.length) setSelectedMonth(ms[0]);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      if (!selectedMonth) return;
      try {
        const ds = await listDays(selectedMonth);
        setDays(Array.isArray(ds) ? ds : []);
        if (Array.isArray(ds) && ds.length) setSelectedDay(ds[0]);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [selectedMonth]);

  React.useEffect(() => {
    (async () => {
      if (!selectedDay) return;
      setLoading(true);
      try {
        const os = await listOrdersByDate(selectedDay);
        setDayOrders(Array.isArray(os) ? os : []);
      } catch (e) {
        console.error(e);
        setDayOrders([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedDay]);

  function formatMonthLong(v) {
    if (!v) return "";
    let y, m;
    let m1 = /^(\d{2})-(\d{4})$/.exec(v);   // MM-YYYY
    let m2 = /^(\d{4})-(\d{2})$/.exec(v);   // YYYY-MM
    if (m1) { m = m1[1]; y = m1[2]; }
    else if (m2) { y = m2[1]; m = m2[2]; }
    else return v;
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleString("en-US", { month: "long", year: "numeric" });
  }

  /* Actions */
  async function openEdit(o) {
    try {
      const full = await getOrder(o.id);
      // TODO: Implement edit modal using 'full'
      alert("Open edit UI for order " + (o.orderCode || o.id));
    } catch (e) { console.error(e); }
  }
  async function deleteOrder(o) {
    if (!confirm("Delete this order?")) return;
    try {
      await apiDeleteOrder(o.id);
      // refresh
      const os = await listOrdersByDate(selectedDay);
      setDayOrders(Array.isArray(os) ? os : []);
    } catch (e) { console.error(e); }
  }
  async function downloadInvoice(o) {
    // Placeholder: Keep your existing invoice logic if you have one
    alert("Invoice download for " + (o.orderCode || o.id));
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Browse Orders */}
      <Section
        title="Browse Orders by Month → Day"
        right={
          selectedDay ? (
            <div className="text-xs sm:text-sm">
              For {formatDateDMY(selectedDay)}: Subtotal <b>{formatTHB(daySubtotal)}</b> • Delivery <b>{formatTHB(dayDelivery)}</b> • <span className="font-bold text-black">Total {formatTHB(dayGrand)}</span>
            </div>
          ) : null
        }
      >
        <div className="space-y-4">
          {/* Month dropdown */}
          <div className="flex items-end gap-3 flex-wrap">
            <div className="min-w-[220px]">
              <Label>Month</Label>
              <select
                className="px-3 py-2 rounded-xl border bg-white w-60"
                value={selectedMonth || ""}
                onChange={(e) => setSelectedMonth(e.target.value)}
              >
                <option value="" disabled>Select month…</option>
                {months.map((m) => (
                  <option key={m} value={m}>{formatMonthLong(m)}</option>
                ))}
                {months.length === 0 && <option value="">No months yet</option>}
              </select>
            </div>

            {/* Day quick pick */}
            <div className="flex-1">
              <Label>Day</Label>
              <div className="flex flex-wrap gap-2">
                {days.map((d) => (
                  <Button
                    key={d}
                    className={selectedDay === d ? "bg-blue-100" : ""}
                    onClick={() => setSelectedDay(d)}
                  >
                    {formatDateDMY(d)}
                  </Button>
                ))}
                {days.length === 0 && <div className="text-sm text-gray-500">No days in this month.</div>}
              </div>
            </div>
          </div>

          {/* Items full width */}
          <div className="rounded-2xl border p-3 sm:p-4 bg-white">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold">Items for {formatDateDMY(selectedDay)}</h4>
              <div className="text-xs text-gray-500">{dayItemTotals.length} products</div>
            </div>
            {dayItemTotals.length === 0 ? (
              <div className="text-sm text-gray-500">No items on this day.</div>
            ) : (
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-4">Item</th>
                      <th className="py-2 pr-4">Qty</th>
                      <th className="py-2 pr-4 hidden sm:table-cell">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayItemTotals.map((r, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-2 pr-4">{r.name}</td>
                        <td className="py-2 pr-4">{r.qty}</td>
                        <td className="py-2 pr-4 hidden sm:table-cell">{formatTHB(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Orders full width */}
          <div className="rounded-2xl border p-3 sm:p-4 bg-white">
            <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="p-2">Seq</th>
                    <th className="p-2">Order #</th>
                    <th className="p-2">Customer</th>
                    <th className="p-2">Subtotal</th>
                    <th className="p-2">Delivery</th>
                    <th className="p-2">Total</th>
                    <th className="p-2 hidden md:table-cell">Notes</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dayOrders.map((o, idx) => (
                    <React.Fragment key={o.id}>
                      <tr className="border-b">
                        <td className="p-2">{idx + 1}</td>
                        <td className="p-2">{o.orderCode}</td>
                        <td className="p-2">
                          {customersMap[o.customerId]?.name ?? o.customerName ?? o.customerId}
                        </td>
                        <td className="p-2">{formatTHB(o.subtotal)}</td>
                        <td className="p-2">{formatTHB(o.deliveryFee)}</td>
                        <td className="p-2 font-bold text-black">{formatTHB(o.total)}</td>
                        <td className="p-2 hidden md:table-cell">{o.notes || "—"}</td>
                        <td className="p-2">
                          <div className="flex gap-2">
                            <Button onClick={() => openEdit(o)}>View / Edit</Button>
                            <Button className="bg-red-100" onClick={() => deleteOrder(o)}>Delete</Button>
                            <Button onClick={() => downloadInvoice(o)}>Invoice PDF</Button>
                          </div>
                        </td>
                      </tr>
                      {o.items?.length ? (
                        <tr className="border-b bg-gray-50">
                          <td colSpan={8} className="p-2">
                            <div className="text-xs uppercase tracking-wide text-gray-600 mb-1">Items</div>
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-sm">
                                <thead>
                                  <tr className="text-left border-b">
                                    <th className="p-2">Item</th>
                                    <th className="p-2" style={{ width: 100 }}>Qty</th>
                                    <th className="p-2" style={{ width: 160 }}>Price</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {o.items.map((it, ii) => (
                                    <tr key={ii} className="border-b">
                                      <td className="p-2">{it.productName}</td>
                                      <td className="p-2">{it.qty}</td>
                                      <td className="p-2">{formatTHB(Number(it.qty || 0) * Number(it.price || 0))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                  {dayOrders.length === 0 && (
                    <tr><td colSpan={8} className="p-2 text-gray-500">No orders on this day.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Section>

      {/* ---------- Create / Add new order ---------- */}
      <Section title="Create New Order">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CustomerTypeahead customers={customers} draft={draft} setDraft={setDraft} />
          <div>
            <Label>Order Date</Label>
            <Input type="date" value={draft.date || selectedDay || ""} onChange={(e)=>setDraft(d=>({...d, date: e.target.value}))} />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={async ()=>{
            if (!draft.customerId || !draft.date) { alert("Select customer and date."); return; }
            try {
              await createOrder({ customerId: draft.customerId, date: draft.date, notes: draft.notes || "" });
              const os = await listOrdersByDate(selectedDay || draft.date);
              setDayOrders(Array.isArray(os) ? os : []);
              setDraft({ date: draft.date, customerId: null, customerName: "" });
              alert("Order created. Use 'View / Edit' to add items.");
            } catch (e) {
              console.error(e);
              alert("Failed to create order.");
            }
          }}>Create Empty Order</Button>
        </div>
      </Section>
    </div>
  );
}
