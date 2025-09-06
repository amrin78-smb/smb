import React, { useEffect, useMemo, useState } from "react";
import {
  listProducts, listCustomers,
  listMonths, listDaysInMonth, listOrdersByDate,
  createOrMergeOrder, updateOrderAndItems, deleteOrder as apiDeleteOrder
} from "../api";
import { todayStr, formatTHB, useFuzzy } from "../utils/format";
import { generateInvoicePDF } from "../utils/invoice";

const Section = ({ title, right, children }) => (
  <div className="w-full max-w-6xl mx-auto my-6 p-5 rounded-2xl shadow border bg-white">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div>{right}</div>
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

export default function Orders() {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);

  // create form
  const [customerId, setCustomerId] = useState(0);
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
      setProducts(ps);
      setCustomers(cs);
      setMonths(ms);
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
  const subtotal = useMemo(() => items.reduce((s,it)=>s + Number(it.qty||0)*Number(it.price||0),0), [items]);
  const total = useMemo(() => Number(subtotal) + Number(deliveryFee||0), [subtotal, deliveryFee]);
  const daySubtotal = useMemo(() => dayOrders.reduce((s,o)=>s+Number(o.subtotal||0),0), [dayOrders]);
  const dayDelivery = useMemo(() => dayOrders.reduce((s,o)=>s+Number(o.deliveryFee||0),0), [dayOrders]);
  const dayGrand = useMemo(() => dayOrders.reduce((s,o)=>s+Number(o.total||0),0), [dayOrders]);

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
      // reset and refresh
      setItems([]);
      setDeliveryFee(0);
      setNotes("");
      // refresh lists
      const ms = await listMonths();
      setMonths(ms);
      setSelectedMonth(date.slice(0,7));
      const ds = await listDaysInMonth(date.slice(0,7));
      setDays(ds);
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
    setEditQ("");
    setEditOpen(true);
  }
  function updateEditItem(i, patch) {
    setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  }
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

  return (
    <>
      <Section title="Create Order">
        <div className="grid grid-cols-12 gap-3 mb-4">
          <div className="col-span-3"><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="col-span-4"><Label>Customer</Label>
            <Select value={customerId} onChange={e => setCustomerId(Number(e.target.value))}>
              <option value={0}>-- Select customer --</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="col-span-3"><Label>Delivery Fee</Label><Input type="number" value={deliveryFee} onChange={e=>setDeliveryFee(Number(e.target.value)||0)} /></div>
          <div className="col-span-2"><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" /></div>
        </div>
        <div className="grid grid-cols-12 gap-3 mb-3">
          <div className="col-span-6">
            <Label>Add item</Label>
            <Input placeholder="Search product by name" value={q} onChange={e => setQ(e.target.value)} />
            {q && (
              <div className="border rounded-xl mt-1 max-h-48 overflow-auto bg-white">
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
        <div className="overflow-auto mb-3">
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
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Subtotal: {formatTHB(subtotal)} &nbsp;•&nbsp; Delivery: {formatTHB(deliveryFee)} &nbsp;•&nbsp; Total: {formatTHB(total)}</div>
          <Button className="bg-green-100" onClick={saveOrder}>Save Order</Button>
        </div>
      </Section>

      <Section title="Browse Orders by Month → Day"
        right={selectedDay ? <div className="text-sm">For {selectedDay}: Subtotal <b>{formatTHB(daySubtotal)}</b> • Delivery <b>{formatTHB(dayDelivery)}</b> • Total <b>{formatTHB(dayGrand)}</b></div> : null}>
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4">
            <Label>Month</Label>
            <div className="border rounded-xl max-h-64 overflow-auto bg-white">
              {months.map(m => (
                <div key={m} className={`p-2 cursor-pointer hover:bg-gray-100 ${selectedMonth === m ? "bg-blue-50" : ""}`} onClick={() => setSelectedMonth(m)}>
                  {m}
                </div>
              ))}
              {months.length === 0 && <div className="p-2 text-gray-500">No months yet.</div>}
            </div>
          </div>
          <div className="col-span-12 md:col-span-8">
            <Label>Day</Label>
            <div className="flex flex-wrap gap-2 mb-3">
              {days.map(d => (
                <Button key={d} className={selectedDay === d ? "bg-blue-100" : ""} onClick={() => setSelectedDay(d)}>{d}</Button>
              ))}
              {days.length === 0 && <div className="text-gray-500">Select a month.</div>}
            </div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="p-2">Seq</th>
                    <th className="p-2">Order #</th>
                    <th className="p-2">Customer</th>
                    <th className="p-2">Subtotal</th>
                    <th className="p-2">Delivery</th>
                    <th className="p-2">Total</th>
                    <th className="p-2">Notes</th>
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
                        <td className="p-2">{formatTHB(o.total)}</td>
                        <td className="p-2">{o.notes || ""}</td>
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
          </div>
        </div>
      </Section>

      {editOpen && editOrder && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-xl border p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Edit Order #{editOrder.orderCode}</h3>
              <Button onClick={()=>setEditOpen(false)}>Close</Button>
            </div>
            <div className="grid grid-cols-12 gap-3 mb-3">
              <div className="col-span-4"><Label>Date</Label><Input type="date" value={editOrder.date} onChange={e=>setEditOrder({...editOrder, date:e.target.value})} /></div>
              <div className="col-span-4"><Label>Customer</Label>
                <Select value={editOrder.customerId} onChange={e=>setEditOrder({...editOrder, customerId:Number(e.target.value)})}>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div className="col-span-4"><Label>Delivery Fee</Label><Input type="number" value={editDeliveryFee} onChange={e=>setEditDeliveryFee(Number(e.target.value)||0)} /></div>
            </div>
            <div className="mb-3">
              <Label>Add item</Label>
              <Input placeholder="Search product by name" value={editQ} onChange={e=>setEditQ(e.target.value)} />
              {editQ && (
                <div className="border rounded-xl mt-1 max-h-48 overflow-auto bg-white">
                  {filteredProductsEdit.slice(0,20).map(p=>(
                    <div key={p.id} className="p-2 hover:bg-gray-100 cursor-pointer flex justify-between" onClick={()=>addEditItemFromProduct(p)}>
                      <span>{p.name}</span><span className="text-gray-700">{formatTHB(p.price)}</span>
                    </div>
                  ))}
                  {filteredProductsEdit.length===0 && <div className="p-2 text-gray-500">No matches</div>}
                </div>
              )}
            </div>
            <div className="overflow-auto mb-3">
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
                  {editItems.length===0 && <tr><td className="p-2 text-gray-500" colSpan={5}>No items.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">
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
