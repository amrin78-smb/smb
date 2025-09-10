import React, { useEffect, useMemo, useState } from "react";
import {
  listProducts, listCustomers,
  listMonths, listDaysInMonth, listOrdersByDate,
  createOrMergeOrder, updateOrderAndItems, deleteOrder as apiDeleteOrder
} from "../api";
import { todayStr, formatTHB, useFuzzy, formatDateDMY, formatMonthMY } from "../utils/format";
import { generateInvoicePDF } from "../utils/invoice";

const Section = ({ title, right, children }) => (
  <div className="w-full max-w-6xl mx-auto my-4 sm:my-6 p-4 sm:p-5 rounded-2xl shadow border bg-white">
    <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
      <h2 className="text-lg sm:text-xl font-semibold">{title}</h2>
      <div className="min-w-0">{right}</div>
    </div>
    {children}
  </div>
);
const Button = ({ children, className = "", ...props }) => (
  <button className={`px-3 py-2 rounded-xl border shadow-sm hover:shadow transition text-sm bg-gray-50 ${className}`} {...props}>
    {children}
  </button>
);
const Input = ({ className = "", ...props }) => (
  <input className={`px-3 py-2 rounded-xl border w-full focus:outline-none focus:ring ${className}`} {...props} />
);
const Select = ({ className = "", children, ...props }) => (
  <select className={`px-3 py-2 rounded-xl border w-full focus:outline-none focus:ring ${className}`} {...props}>{children}</select>
);
const Label = ({ children }) => (<label className="text-sm text-gray-600">{children}</label>);

/* ---------- Helper to render "September 2025" for your month keys ---------- */
function formatMonthLong(m) {
  // Accepts "YYYY-MM" or "MM-YYYY" (since formatMonthMY handles display elsewhere)
  if (!m) return "";
  let y, mm;
  const a = /^(\d{4})-(\d{2})$/.exec(m);
  const b = /^(\d{2})-(\d{4})$/.exec(m);
  if (a) { y = a[1]; mm = a[2]; }
  else if (b) { mm = b[1]; y = b[2]; }
  else return m;
  const d = new Date(Number(y), Number(mm) - 1, 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default function Orders() {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);

  // create form
  const [customerId, setCustomerId] = useState(0);
  const [customerQ, setCustomerQ] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerHi, setCustomerHi] = useState(0);

  const [date, setDate] = useState(todayStr());
  const [notes, setNotes] = useState("");
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");

  // browse
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [days, setDays] = useState([]);
  const [selectedDay, setSelectedDay] = useState("");
  const [dayOrders, setDayOrders] = useState([]);

  // edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editOrder, setEditOrder] = useState(null);
  const [editItems, setEditItems] = useState([]);
  const [editDeliveryFee, setEditDeliveryFee] = useState(0);
  const [editQ, setEditQ] = useState("");

  useEffect(() => {
    (async () => {
      const [ps, cs, ms] = await Promise.all([listProducts(), listCustomers(), listMonths()]);
      setProducts(ps); setCustomers(cs); setMonths(ms);
      if (ms[0]) setSelectedMonth(ms[0]);
    })().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedMonth) { setDays([]); setSelectedDay(""); setDayOrders([]); return; }
    (async () => {
      const ds = await listDaysInMonth(selectedMonth);
      setDays(ds);
      if (ds[0]) setSelectedDay(ds[0]);
    })().catch(console.error);
  }, [selectedMonth]);

  useEffect(() => {
    if (!selectedDay) { setDayOrders([]); return; }
    (async () => setDayOrders(await listOrdersByDate(selectedDay)))().catch(console.error);
  }, [selectedDay]);

  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const customersMap = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers]);

  const filteredProducts = useFuzzy(products, ["name"], q);
  const filteredProductsEdit = useFuzzy(products, ["name"], editQ);

  // Customer typeahead (search name/phone/address; show top when empty)
  const customersAlpha = useMemo(
    () => customers.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||"", "en", {sensitivity:"base"})),
    [customers]
  );
  const filteredCustomers = useMemo(() => {
    if (!customerQ) return customersAlpha.slice(0, 12);
    return useFuzzy(customersAlpha, ["name", "phone", "address"], customerQ).slice(0, 12);
  }, [customersAlpha, customerQ, useFuzzy]);

  const subtotal = useMemo(() => items.reduce((s,it)=>s + Number(it.qty||0)*Number(it.price||0),0), [items]);
  const total = useMemo(() => Number(subtotal) + Number(deliveryFee||0), [subtotal, deliveryFee]);
  const daySubtotal = useMemo(() => dayOrders.reduce((s,o)=>s+Number(o.subtotal||0),0), [dayOrders]);
  const dayDelivery = useMemo(() => dayOrders.reduce((s,o)=>s+Number(o.deliveryFee||0),0), [dayOrders]);
  const dayGrand = useMemo(() => dayOrders.reduce((s,o)=>s+Number(o.total||0),0), [dayOrders]);

  // Aggregate items for the selected day
  const dayItemTotals = useMemo(() => {
    const map = new Map();
    for (const o of dayOrders) {
      for (const it of (o.items || [])) {
        const key = it.productId ?? it.productName;
        const name = it.productName || productMap[it.productId]?.name || "Unknown item";
        const qty = Number(it.qty || 0);
        const amount = qty * Number(it.price || 0);
        const prev = map.get(key) || { name, qty: 0, amount: 0 };
        prev.qty += qty;
        prev.amount += amount;
        map.set(key, prev);
      }
    }
    return Array.from(map.values()).sort((a,b) => b.qty - a.qty);
  }, [dayOrders, productMap]);

  function addItemFromProduct(p) {
    setItems(prev => {
      const idx = prev.findIndex(x => x.productId === p.id);
      if (idx >= 0) { const cp = [...prev]; cp[idx] = { ...cp[idx], qty: Number(cp[idx].qty) + 1, price: p.price }; return cp; }
      return [...prev, { productId: p.id, qty: 1, price: p.price }];
    });
    setQ("");
  }
  const updateItem = (i, patch) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));

  async function saveOrder() {
    try {
      if (!customerId) return alert("Select a customer");
      if (items.length === 0) return alert("Add at least one item");
      await createOrMergeOrder({
        date,
        customerId: Number(customerId),
        deliveryFee: Number(deliveryFee || 0),
        notes,
        items: items.map(it => ({ productId: it.productId, qty: Number(it.qty), price: Number(it.price) })),
      });
      setItems([]); setDeliveryFee(0); setNotes("");
      const ms = await listMonths(); setMonths(ms);
      setSelectedMonth(date.slice(0,7));
      const ds = await listDaysInMonth(date.slice(0,7)); setDays(ds);
      setSelectedDay(date);
      setDayOrders(await listOrdersByDate(date));
      alert("Order saved / consolidated");
    } catch (e) {
      console.error(e);
      alert("Failed to save: " + (e?.message || String(e)));
    }
  }

  function openEdit(o) {
    setEditOrder(o);
    setEditItems((o.items || []).map(it => ({ productId: it.productId, qty: it.qty, price: it.price })));
    setEditDeliveryFee(Number(o.deliveryFee || 0));
    setEditQ(""); setEditOpen(true);
  }
  function updateEditItem(i, patch) { setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it)); }
  function removeEditItem(i) { setEditItems(prev => prev.filter((_, idx) => idx !== i)); }
  function addEditItemFromProduct(p) {
    setEditItems(prev => {
      const idx = prev.findIndex(x => x.productId === p.id);
      if (idx >= 0) { const cp = [...prev]; cp[idx] = { ...cp[idx], qty: Number(cp[idx].qty)+1, price: p.price }; return cp; }
      return [...prev, { productId: p.id, qty: 1, price: p.price }];
    });
    setEditQ("");
  }
  async function saveEdit() {
    try {
      await updateOrderAndItems({
        id: editOrder.id,
        date: editOrder.date,
        customerId: editOrder.customerId,
        deliveryFee: Number(editDeliveryFee || 0),
        notes: editOrder.notes || "",
        items: editItems.map(it => ({ productId: it.productId, qty: Number(it.qty), price: Number(it.price) })),
      });
      setEditOpen(false);
      setDayOrders(await listOrdersByDate(editOrder.date));
      alert("Order updated");
    } catch (e) {
      console.error(e);
      alert("Failed to update: " + (e?.message || String(e)));
    }
  }
  async function deleteOrder(o) {
    if (!confirm(`Delete order #${o.orderCode}?`)) return;
    await apiDeleteOrder(o.id);
    setDayOrders(await listOrdersByDate(selectedDay));
  }
  async function downloadInvoice(o) {
    try {
      const cust = customersMap[o.customerId];
      await generateInvoicePDF(o, cust);
    } catch (e) {
      console.error(e);
      alert("Failed to generate invoice: " + (e?.message || String(e)));
    }
  }

  // Customer typeahead handlers
  function chooseCustomer(c) {
    setCustomerId(Number(c.id));
    setCustomerQ("");
    setCustomerOpen(false);
  }
  function onCustomerKey(e) {
    if (!customerOpen) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCustomerHi(i => Math.min(i + 1, filteredCustomers.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCustomerHi(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filteredCustomers[customerHi]) chooseCustomer(filteredCustomers[customerHi]); }
    else if (e.key === "Escape") { setCustomerOpen(false); }
  }

  return (
    <>
      {/* Create Order */}
      <Section title="Create Order">
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 sm:col-span-4">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>

          {/* Customer typeahead (replaces Select) */}
          <div className="col-span-12 sm:col-span-5 relative">
            <Label>Customer</Label>
            <Input
              placeholder="Type name / phone / address…"
              value={customerQ}
              onChange={e => { setCustomerQ(e.target.value); setCustomerOpen(true); }}
              onFocus={() => setCustomerOpen(true)}
              onKeyDown={onCustomerKey}
              onBlur={() => setTimeout(() => setCustomerOpen(false), 120)}
            />
            {customerOpen && (customerQ || filteredCustomers.length > 0) && (
              <div className="absolute z-40 mt-1 w-full max-h-64 overflow-auto rounded-xl border bg-white shadow">
                {filteredCustomers.length === 0 && (
                  <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
                )}
                {filteredCustomers.map((c, idx) => (
                  <button
                    key={c.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => chooseCustomer(c)}
                    className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${idx === customerHi ? "bg-gray-100" : ""}`}
                  >
                    <div className="font-medium">{c.name || "—"}</div>
                    <div className="text-xs text-gray-600">
                      {c.phone || "—"}{c.address ? ` • ${c.address}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {/* Selected helper line */}
            {customerId ? (
              <div className="mt-1 text-xs text-gray-600">
                <span className="font-medium">Selected:</span> {customersMap[customerId]?.name || "—"}
                {customersMap[customerId]?.phone ? ` • ${customersMap[customerId]?.phone}` : ""}
                {customersMap[customerId]?.address ? ` • ${customersMap[customerId]?.address}` : ""}
              </div>
            ) : null}
          </div>

          <div className="col-span-6 sm:col-span-2">
            <Label>Delivery Fee</Label>
            <Input type="number" value={deliveryFee} onChange={e=>setDeliveryFee(Number(e.target.value)||0)} />
          </div>
          <div className="col-span-6 sm:col-span-1">
            <Label>Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="grid grid-cols-12 gap-3 mt-3">
          <div className="col-span-12 sm:col-span-6">
            <Label>Add item</Label>
            <Input placeholder="Search product by name" value={q} onChange={e => setQ(e.target.value)} />
            {q && (
              <div className="border rounded-xl mt-1 max-h-56 overflow-auto bg-white">
                {filteredProducts.slice(0, 20).map(p => (
                  <div key={p.id} className="p-2 hover:bg-gray-100 cursor-pointer flex justify-between" onClick={() => addItemFromProduct(p)}>
                    <span>{p.name}</span><span className="text-gray-700">{formatTHB(p.price)}</span>
                  </div>
                ))}
                {filteredProducts.length === 0 && <div className="p-2 text-gray-500">No matches</div>}
              </div>
            )}
          </div>
        </div>

        {/* Table (desktop) + Cards (mobile) */}
        <div className="mt-3">
          <div className="hidden sm:block overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left border-b"><th className="p-2">Item</th><th className="p-2">Qty</th><th className="p-2">Unit Price</th><th className="p-2">Line Total</th><th className="p-2">Actions</th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-2">{productMap[it.productId]?.name || "(unknown)"}</td>
                    <td className="p-2" style={{ width: 90 }}><Input type="number" value={it.qty} onChange={e => updateItem(i, { qty: Number(e.target.value) || 0 })} /></td>
                    <td className="p-2" style={{ width: 140 }}><Input type="number" value={it.price} onChange={e => updateItem(i, { price: Number(e.target.value) || 0 })} /></td>
                    <td className="p-2">{formatTHB((it.qty || 0) * (it.price || 0))}</td>
                    <td className="p-2"><Button onClick={() => removeItem(i)}>Remove</Button></td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={5}>No items yet. Search above to add.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {items.map((it, i) => (
              <div key={i} className="border rounded-xl p-3 bg-white shadow-sm">
                <div className="font-medium">{productMap[it.productId]?.name || "(unknown)"}</div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <Input type="number" value={it.qty} onChange={e=>updateItem(i,{qty:Number(e.target.value)||0})} />
                  <Input type="number" value={it.price} onChange={e=>updateItem(i,{price:Number(e.target.value)||0})} />
                </div>
                <div className="flex justify-between items-center mt-2 text-sm">
                  <div>Line: <b>{formatTHB((it.qty||0)*(it.price||0))}</b></div>
                  <Button onClick={() => removeItem(i)}>Remove</Button>
                </div>
              </div>
            ))}
            {items.length === 0 && <div className="text-gray-500 text-sm">No items yet. Search above to add.</div>}
          </div>
        </div>

        <div className="hidden sm:flex items-center justify-between mt-3">
          <div className="text-base sm:text-lg font-semibold">
            Subtotal: {formatTHB(subtotal)} &nbsp;•&nbsp; Delivery: {formatTHB(deliveryFee)} &nbsp;•&nbsp; <span className="font-bold">Total: {formatTHB(total)}</span>
          </div>
          <Button className="bg-green-100" onClick={saveOrder}>Save Order</Button>
        </div>

        {/* Sticky Save (mobile) */}
        <div className="sm:hidden h-16" />
        <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur border-t p-3 flex items-center justify-between">
          <div className="text-sm">
            <b>{formatTHB(total)}</b> &nbsp;
            <span className="text-gray-500">({formatTHB(subtotal)} + {formatTHB(deliveryFee)})</span>
          </div>
          <Button className="bg-green-100" onClick={saveOrder}>Save</Button>
        </div>
      </Section>

      {/* Browse Orders */}
      <Section
        title="Browse Orders by Month → Day"
        right={
          selectedDay ? (
            <div className="text-xs sm:text-sm">
              For {formatDateDMY(selectedDay)}: Subtotal <b>{formatTHB(daySubtotal)}</b> • Delivery <b>{formatTHB(dayDelivery)}</b> • Total <b>{formatTHB(dayGrand)}</b>
            </div>
          ) : null
        }
      >
        {/* Replaced left month list with top dropdown; everything below is full width */}
        <div className="space-y-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="min-w-[220px]">
              <Label>Month</Label>
              <Select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="w-60">
                {months.length === 0 && <option value="">No months yet</option>}
                {months.map(m => (
                  <option key={m} value={m}>{formatMonthLong(m)}</option>
                ))}
              </Select>
            </div>

            <div className="flex-1">
              <Label>Day</Label>
              <div className="flex flex-wrap gap-2 mb-3">
                {days.map(d => (
                  <Button key={d} className={selectedDay === d ? "bg-blue-100" : ""} onClick={() => setSelectedDay(d)}>{formatDateDMY(d)}</Button>
                ))}
                {days.length === 0 && <div className="text-gray-500">Select a month.</div>}
              </div>
            </div>
          </div>

          {/* Items summary (full width) */}
          {selectedDay && (
            <div className="p-3 rounded-2xl border bg-white">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium">Items for {formatDateDMY(selectedDay)}</h4>
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
            </div>
          )}

          {/* Desktop table (full width) */}
          <div className="hidden sm:block overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
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
                      <td className="p-2">{customersMap[o.customerId]?.name ?? o.customerName ?? o.customerId}</td>
                      <td className="p-2">{formatTHB(o.subtotal)}</td>
                      <td className="p-2">{formatTHB(o.deliveryFee)}</td>
                      <td className="p-2 font-bold">{formatTHB(o.total)}</td>
                      <td className="p-2 hidden md:table-cell">{o.notes || ""}</td>
                      <td className="p-2 flex gap-2">
                        <Button onClick={() => openEdit(o)}>View / Edit</Button>
                        <Button className="bg-red-100" onClick={() => deleteOrder(o)}>Delete</Button>
                        <Button onClick={() => downloadInvoice(o)}>Invoice PDF</Button>
                      </td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td className="p-2 text-gray-500" colSpan={8}>
                        <div className="text-xs uppercase tracking-wide mb-1">Items</div>
                        {(o.items || []).length === 0 && <div className="text-sm text-gray-500">No items.</div>}
                        {(o.items || []).length > 0 && (
                          <div className="flex flex-wrap gap-3">
                            {(o.items || []).map((it, i) => (
                              <div key={i} className="px-2 py-1 rounded-lg border bg-white">
                                {it.productName} &times; {it.qty} @ {formatTHB(it.price)} = <b>{formatTHB(it.qty*it.price)}</b>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
                {selectedDay && dayOrders.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={8}>No orders that day.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {dayOrders.map((o, idx) => (
              <div key={o.id} className="border rounded-2xl p-3 bg-white">
                <div className="flex justify-between items-center">
                  <div className="font-medium">{idx + 1}. {o.orderCode}</div>
                  <div className="text-sm font-bold">{formatTHB(o.total)}</div>
                </div>
                <div className="text-sm text-gray-600">{customersMap[o.customerId]?.name ?? o.customerName ?? o.customerId}</div>
                <div className="text-xs text-gray-500 mt-1">
                  Subtotal {formatTHB(o.subtotal)} • Delivery {formatTHB(o.deliveryFee)}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button onClick={() => openEdit(o)}>View / Edit</Button>
                  <Button className="bg-red-100" onClick={() => deleteOrder(o)}>Delete</Button>
                  <Button onClick={() => downloadInvoice(o)}>Invoice PDF</Button>
                </div>
                {(o.items || []).length > 0 && (
                  <div className="mt-2 border-t pt-2 text-sm">
                    {(o.items || []).map((it, i) => (
                      <div key={i} className="flex justify-between">
                        <div className="mr-2">{it.productName} × {it.qty}</div>
                        <div>{formatTHB(it.qty * it.price)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {selectedDay && dayOrders.length === 0 && <div className="text-gray-500">No orders that day.</div>}
          </div>
        </div>
      </Section>

      {/* Edit modal (unchanged core logic) */}
      {editOpen && editOrder && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-xl border p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Edit Order #{editOrder.orderCode}</h3>
              <Button onClick={()=>setEditOpen(false)}>Close</Button>
            </div>
            <div className="grid grid-cols-12 gap-3 mb-3">
              <div className="col-span-12 sm:col-span-4"><Label>Date</Label><Input type="date" value={editOrder.date} onChange={e=>setEditOrder({...editOrder, date:e.target.value})} /></div>
              <div className="col-span-12 sm:col-span-5"><Label>Customer</Label>
                <Select value={editOrder.customerId} onChange={e=>setEditOrder({...editOrder, customerId:Number(e.target.value)})}>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div className="col-span-12 sm:col-span-3"><Label>Delivery Fee</Label><Input type="number" value={editDeliveryFee} onChange={e=>setEditDeliveryFee(Number(e.target.value)||0)} /></div>
            </div>

            <div className="mb-3">
              <Label>Add item</Label>
              <Input placeholder="Search product by name" value={editQ} onChange={e=>setEditQ(e.target.value)} />
              {editQ && (
                <div className="border rounded-xl mt-1 max-h-56 overflow-auto bg-white">
                  {filteredProductsEdit.slice(0,20).map(p=>(
                    <div key={p.id} className="p-2 hover:bg-gray-100 cursor-pointer flex justify-between" onClick={()=>addEditItemFromProduct(p)}>
                      <span>{p.name}</span><span className="text-gray-700">{formatTHB(p.price)}</span>
                    </div>
                  ))}
                  {filteredProductsEdit.length===0 && <div className="p-2 text-gray-500">No matches</div>}
                </div>
              )}
            </div>

            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 mb-3 hidden sm:block">
              <table className="min-w-full text-sm">
                <thead><tr className="text-left border-b"><th className="p-2">Item</th><th className="p-2">Qty</th><th className="p-2">Unit Price</th><th className="p-2">Line Total</th><th className="p-2">Actions</th></tr></thead>
                <tbody>
                  {editItems.map((it,i)=>(
                    <tr key={i} className="border-b">
                      <td className="p-2">{productMap[it.productId]?.name || "(deleted product)"}</td>
                      <td className="p-2" style={{width:90}}><Input type="number" value={it.qty} onChange={e=>updateEditItem(i,{qty:Number(e.target.value)||0})} /></td>
                      <td className="p-2" style={{width:140}}><Input type="number" value={it.price} onChange={e=>updateEditItem(i,{price:Number(e.target.value)||0})} /></td>
                      <td className="p-2">{formatTHB((it.qty||0)*(it.price||0))}</td>
                      <td className="p-2"><Button onClick={()=>removeEditItem(i)}>Remove</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden space-y-2 mb-3">
              {editItems.map((it,i)=>(
                <div key={i} className="border rounded-xl p-3">
                  <div className="font-medium">{productMap[it.productId]?.name || "(deleted product)"}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <Input type="number" value={it.qty} onChange={e=>updateEditItem(i,{qty:Number(e.target.value)||0})} />
                    <Input type="number" value={it.price} onChange={e=>updateEditItem(i,{price:Number(e.target.value)||0})} />
                  </div>
                  <div className="flex justify-between items-center mt-2 text-sm">
                    <div>Line: <b>{formatTHB((it.qty||0)*(it.price||0))}</b></div>
                    <Button onClick={()=>removeEditItem(i)}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <div className="text-base sm:text-lg font-semibold">
                Subtotal: {formatTHB(editItems.reduce((s,it)=>s+(Number(it.qty||0)*Number(it.price||0)),0))}
                &nbsp;•&nbsp; Delivery: {formatTHB(editDeliveryFee)}
              </div>
              <Button className="bg-green-100" onClick={saveEdit}>Save Changes</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
