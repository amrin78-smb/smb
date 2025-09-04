import React, { useEffect, useMemo, useState } from "react";
import Dexie from "https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm";
import jsPDF from "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm";
import autoTable from "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.1/+esm";

/* =====================================
   Dexie (IndexedDB) database
===================================== */
const db = new Dexie("smb_local_orders_db");

// v1 schema
db.version(1).stores({
  products: "++id,name,price",
  customers: "++id,name,phone,address,grabwin,grabcar,nationality",
  orders: "++id,date,customerId,total,notes",
  orderItems: "++id,orderId,productId,qty,price",
});

// v2 schema adds orderCode
db.version(2).stores({
  products: "++id,name,price",
  customers: "++id,name,phone,address,grabwin,grabcar,nationality",
  orders: "++id,date,customerId,total,notes,orderCode",
  orderItems: "++id,orderId,productId,qty,price",
}).upgrade(async tx => {
  const orders = await tx.table("orders").toArray();
  for (const o of orders) {
    if (!o.orderCode) {
      const code = await generateOrderCode(o.date, tx);
      await tx.table("orders").update(o.id, { orderCode: code });
    }
  }
});

async function ensureSeed() {
  const [pcount, ccount] = await Promise.all([db.products.count(), db.customers.count()]);
  if (pcount === 0) {
    await db.products.bulkAdd([
      { name: "Nasi Lemak", price: 60 },
      { name: "Kuih Bingka Ubi", price: 35 },
      { name: "Apam Balik", price: 45 },
    ]);
  }
  if (ccount === 0) {
    await db.customers.bulkAdd([
      { name: "Walk-in", phone: "", address: "", grabwin: "", grabcar: "", nationality: "" },
      { name: "Ice", phone: "080-333-4444", address: "", grabwin: "", grabcar: "", nationality: "TH" },
    ]);
  }
}

/* =====================================
   Utils
===================================== */
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthKey = (d) => (d || "").slice(0, 7);

const formatTHB = (n) =>
  new Intl.NumberFormat("en-TH", { style: "currency", currency: "THB" }).format(Number(n || 0));

function ddmmyy(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}${m}${y.slice(2)}`;
}
async function generateOrderCode(dateStr, tx) {
  const t = tx ? tx.table("orders") : db.orders;
  const sameDay = await t.where("date").equals(dateStr).toArray();
  const next = sameDay.length + 1;
  return `${ddmmyy(dateStr)}_${next}`;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(csvText) {
  const rows = [];
  let cur = "", row = [], q = false;
  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (ch === '"') { if (q && csvText[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { row.push(cur); cur = ""; }
    else if ((ch === "\n" || ch === "\r") && !q) { if (cur.length || row.length) { row.push(cur); rows.push(row); row = []; cur = ""; } }
    else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.length && r.some(c => (c ?? "").trim() !== ""));
}
function toCSV(rows) {
  const esc = v => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  return rows.map(r => r.map(esc).join(",")).join("\n");
}
function useFuzzy(items, keys, query) {
  return useMemo(() => {
    const q = (query || "").toLowerCase();
    if (!q) return items;
    return items.filter(it => keys.some(k => String(it[k] || "").toLowerCase().includes(q)));
  }, [items, keys, query]);
}

/* =====================================
   Small UI kit
===================================== */
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

/* =====================================
   Dashboard
===================================== */
function Dashboard() {
  const [stats, setStats] = useState({ orders: 0, revenue: 0, items: 0 });
  const [todayOrders, setTodayOrders] = useState([]);

  useEffect(() => {
    (async () => {
      await ensureSeed();
      const orders = await db.orders.where("date").equals(todayStr()).toArray();
      orders.sort((a,b) => a.id - b.id);
      let revenue = 0, items = 0;
      for (const o of orders) {
        revenue += Number(o.total || 0);
        const its = await db.orderItems.where({ orderId: o.id }).toArray();
        items += its.reduce((s,it) => s + Number(it.qty || 0), 0);
      }
      setStats({ orders: orders.length, revenue, items });
      setTodayOrders(orders);
    })();
  }, []);

  return (
    <div className="max-w-6xl mx-auto mt-6 grid gap-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Orders Today" value={stats.orders} />
        <StatCard label="Items Sold Today" value={stats.items} />
        <StatCard label="Revenue Today" value={formatTHB(stats.revenue)} />
      </div>

      <Section title="Today’s Orders" right={<div className="text-sm text-gray-500">{todayStr()}</div>}>
        <table className="min-w-full text-sm">
          <thead><tr className="text-left border-b">
            <th className="p-2">Seq</th>
            <th className="p-2">Order #</th>
            <th className="p-2">Customer</th>
            <th className="p-2">Total</th>
            <th className="p-2">Notes</th>
          </tr></thead>
          <tbody>
            {todayOrders.map((o, idx) => <DashboardRow key={o.id} order={o} seq={idx+1} />)}
            {todayOrders.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={5}>No orders yet today.</td></tr>}
          </tbody>
        </table>
      </Section>

      <Section title="How to use">
        <ul className="list-disc pl-6 text-sm text-gray-700 space-y-1">
          <li>Use <b>Orders</b> to create and review orders.</li>
          <li>Manage <b>Products</b> and <b>Customers</b>.</li>
          <li>Import/Export CSV and backups in <b>Settings</b>.</li>
          <li>All data is stored locally (IndexedDB via Dexie).</li>
        </ul>
      </Section>
    </div>
  );
}
const StatCard = ({ label, value }) => (
  <div className="p-4 bg-white border rounded-2xl shadow">
    <div className="text-sm text-gray-500">{label}</div>
    <div className="text-2xl font-semibold">{value}</div>
  </div>
);
function DashboardRow({ order, seq }) {
  const [custName, setCustName] = useState("");
  useEffect(() => { db.customers.get(order.customerId).then(c => setCustName(c?.name || "")); }, [order.customerId]);
  return (
    <tr className="border-b">
      <td className="p-2">{seq}</td>
      <td className="p-2">{order.orderCode || order.id}</td>
      <td className="p-2">{custName}</td>
      <td className="p-2">{formatTHB(order.total)}</td>
      <td className="p-2">{order.notes || ""}</td>
    </tr>
  );
}

/* =====================================
   Orders (Create + Browse + View/Edit/Delete)
===================================== */
function OrderBuilder() {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [customerId, setCustomerId] = useState(0);
  const [date, setDate] = useState(() => todayStr());
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");

  // lists
  const [recentOrders, setRecentOrders] = useState([]);
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [days, setDays] = useState([]);
  const [selectedDay, setSelectedDay] = useState("");
  const [dayOrders, setDayOrders] = useState([]);
  const dayTotal = useMemo(() => dayOrders.reduce((s, o) => s + Number(o.total || 0), 0), [dayOrders]);

  // edit modal
  const [editOpen,setEditOpen]=useState(false);
  const [editOrder,setEditOrder]=useState(null);
  const [editItems,setEditItems]=useState([]);
  const [editTotal,setEditTotal]=useState(0);
  const [editQ, setEditQ] = useState("");

  useEffect(() => {
    (async () => {
      await ensureSeed();
      setCustomers(await db.customers.orderBy("name").toArray());
      setProducts(await db.products.orderBy("name").toArray());
      setRecentOrders(await db.orders.orderBy("id").toArray()); // ASC

      // Build months list from all orders
      const all = await db.orders.orderBy("date").reverse().toArray();
      const ms = Array.from(new Set(all.map(o => monthKey(o.date)))).filter(Boolean);
      setMonths(ms);
      if (ms[0]) setSelectedMonth(ms[0]);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!selectedMonth) { setDays([]); setSelectedDay(""); setDayOrders([]); return; }
      // Pull all orders in month; derive unique days
      const list = await db.orders.where("date").between(`${selectedMonth}-00`, `${selectedMonth}-99`).toArray();
      const uniqDays = Array.from(new Set(list.map(o => o.date))).sort((a, b) => b.localeCompare(a));
      setDays(uniqDays);
      if (uniqDays[0]) setSelectedDay(uniqDays[0]);
    })();
  }, [selectedMonth]);

  // FIX: more robust day fetch (filter all orders by exact date)
  useEffect(() => {
    (async () => {
      if (!selectedDay) { setDayOrders([]); return; }
      const all = await db.orders.toArray();
      const list = all.filter(o => o.date === selectedDay).sort((a,b)=>a.id-b.id);
      setDayOrders(list);
    })();
  }, [selectedDay]);

  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const total = useMemo(() => items.reduce((s, it) => s + (Number(it.qty || 0) * Number(it.price || 0)), 0), [items]);
  const filteredProducts = useFuzzy(products, ["name"], q);
  const filteredProductsEdit = useFuzzy(products, ["name"], editQ);

  function addItemFromProduct(p) {
    setItems(prev => {
      const i = prev.findIndex(x => x.productId === p.id);
      if (i >= 0) { const cp = [...prev]; cp[i] = { ...cp[i], qty: Number(cp[i].qty) + 1, price: p.price }; return cp; }
      return [...prev, { productId: p.id, name: p.name, price: p.price, qty: 1 }];
    });
    setQ("");
  }
  const updateItem = (i, patch) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));

  // Consolidating save + orderCode
  async function saveOrder() {
    try {
      if (!customerId) return alert("Select a customer");
      if (items.length === 0) return alert("Add at least one item");

      const custId = Number(customerId);

      const existing = await db.orders
        .where("date").equals(date)
        .and(o => o.customerId === custId)
        .first();

      if (existing) {
        await db.transaction('rw', db.orders, db.orderItems, async () => {
          const existingItems = await db.orderItems.where({ orderId: existing.id }).toArray();
          const byProd = new Map(existingItems.map(it => [it.productId, it]));
          for (const newIt of items) {
            const prev = byProd.get(newIt.productId);
            if (prev) {
              await db.orderItems.update(prev.id, {
                qty: Number(prev.qty || 0) + Number(newIt.qty || 0),
                price: Number(newIt.price || prev.price || 0),
              });
            } else {
              await db.orderItems.add({
                orderId: existing.id, productId: newIt.productId, qty: Number(newIt.qty || 0), price: Number(newIt.price || 0),
              });
            }
          }
          const merged = await db.orderItems.where({ orderId: existing.id }).toArray();
          const newTotal = merged.reduce((s, it) => s + Number(it.qty || 0) * Number(it.price || 0), 0);
          const newNotes = notes ? (existing.notes ? `${existing.notes} | ${notes}` : notes) : (existing.notes || "");
          await db.orders.update(existing.id, { total: newTotal, notes: newNotes });
        });
        await refreshAll(date);
        setItems([]);
        alert(`Order consolidated into #${existing.orderCode || existing.id}`);
        return;
      }

      const orderCode = await generateOrderCode(date);
      const oid = await db.orders.add({ date, customerId: custId, total, notes, orderCode });
      await db.orderItems.bulkAdd(items.map(it => ({ orderId: oid, productId: it.productId, qty: Number(it.qty), price: Number(it.price) })));
      await refreshAll(date);
      setItems([]);
      alert(`Order saved as #${orderCode}`);
    } catch (err) {
      console.error(err);
      alert("Failed to save order: " + (err?.message || String(err)));
    }
  }

  async function refreshAll(focusDate){
    setRecentOrders(await db.orders.orderBy("id").toArray());
    const m = monthKey(focusDate);
    if(!months.includes(m)) setMonths(prev=>[m,...prev]);
    setSelectedMonth(m);
    setSelectedDay(focusDate);
  }

  async function exportOrdersCSV() {
    const rows = [["OrderCode","Date","Customer","Item","Qty","UnitPrice","LineTotal","Notes"]];
    const orders = await db.orders.orderBy("id").toArray();
    for (const o of orders) {
      const cust = await db.customers.get(o.customerId);
      const its = await db.orderItems.where({ orderId: o.id }).toArray();
      for (const it of its) {
        const p = await db.products.get(it.productId);
        rows.push([o.orderCode || o.id, o.date, cust?.name || "", p?.name || "", it.qty, it.price, (it.qty * it.price).toFixed(2), o.notes || ""]);
      }
    }
    downloadText("orders.csv", toCSV(rows));
  }

  async function openEdit(order){
    const its=await db.orderItems.where({orderId:order.id}).toArray();
    const mapped=its.map(it=>({productId:it.productId, qty:it.qty, price:it.price, name:productMap[it.productId]?.name||""}));
    setEditOrder({...order});
    setEditItems(mapped);
    setEditTotal(mapped.reduce((s,it)=>s+(Number(it.qty||0)*Number(it.price||0)),0));
    setEditQ("");
    setEditOpen(true);
  }
  const updateEditItem=(i,patch)=>{
    setEditItems(prev=>{
      const cp=prev.map((it,idx)=>idx===i?{...it,...patch}:it);
      setEditTotal(cp.reduce((s,it)=>s+(Number(it.qty||0)*Number(it.price||0)),0));
      return cp;
    });
  };
  const removeEditItem=(i)=>{
    setEditItems(prev=>{
      const cp=prev.filter((_,idx)=>idx!==i);
      setEditTotal(cp.reduce((s,it)=>s+(Number(it.qty||0)*Number(it.price||0)),0));
      return cp;
    });
  };
  function addEditItemFromProduct(p){
    setEditItems(prev=>{
      const i=prev.findIndex(x=>x.productId===p.id);
      if(i>=0){ const cp=[...prev]; cp[i]={...cp[i], qty:Number(cp[i].qty)+1, price:p.price}; return cp; }
      return [...prev,{productId:p.id, qty:1, price:p.price, name:p.name}];
    });
    setEditQ("");
  }

  async function saveEdit(){
    try{
      if(!editOrder?.id) return;
      if(!editOrder.customerId) return alert("Select a customer");
      if(editItems.length===0) return alert("Order needs at least one item");
      await db.transaction('rw', db.orders, db.orderItems, async ()=>{
        await db.orders.update(editOrder.id, { date:editOrder.date, customerId:Number(editOrder.customerId), notes:editOrder.notes||"", total:editTotal });
        const existing = await db.orderItems.where({orderId:editOrder.id}).primaryKeys();
        if(existing.length) await db.orderItems.bulkDelete(existing);
        await db.orderItems.bulkAdd(editItems.map(it=>({ orderId:editOrder.id, productId:it.productId, qty:Number(it.qty), price:Number(it.price) })));
      });
      setEditOpen(false);
      await refreshAll(editOrder.date);
      alert("Order updated");
    }catch(err){ console.error(err); alert("Failed to update: "+(err?.message||String(err))); }
  }

  async function deleteOrder(order) {
    if (!confirm(`Delete order #${order.orderCode || order.id}?`)) return;
    await db.transaction('rw', db.orders, db.orderItems, async () => {
      const keys = await db.orderItems.where({ orderId: order.id }).primaryKeys();
      if (keys.length) await db.orderItems.bulkDelete(keys);
      await db.orders.delete(order.id);
    });
    setDayOrders(prev => prev.filter(o => o.id !== order.id));
    setRecentOrders(prev => prev.filter(o => o.id !== order.id));
    await recomputeCalendarsAfterChange(order.date);
  }
  async function recomputeCalendarsAfterChange(focusDate) {
    const m = monthKey(focusDate);
    const inMonth = await db.orders.where("date").between(`${m}-00`, `${m}-99`).toArray();
    const newDays = Array.from(new Set(inMonth.map(o => o.date))).sort((a, b) => b.localeCompare(a));
    if (newDays.length === 0) {
      setMonths(prev => {
        const next = prev.filter(x => x !== m);
        if (selectedMonth === m) { setSelectedMonth(next[0] || ""); setSelectedDay(""); }
        return next;
      });
      return;
    }
    setDays(newDays);
    if (!newDays.includes(selectedDay)) setSelectedDay(newDays[0]);
  }

  return (
    <>
      <Section title="Create Order" right={<Button onClick={exportOrdersCSV}>Export Orders CSV</Button>}>
        <div className="grid grid-cols-12 gap-3 mb-4">
          <div className="col-span-3"><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="col-span-5"><Label>Customer</Label>
            <Select value={customerId} onChange={e => setCustomerId(Number(e.target.value))}>
              <option value={0}>-- Select customer --</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="col-span-4"><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" /></div>
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
                  <td className="p-2">{productMap[it.productId]?.name || it.name}</td>
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
          <div className="text-lg font-semibold">Total: {formatTHB(total)}</div>
          <Button className="bg-green-100" onClick={saveOrder}>Save Order</Button>
        </div>

        <div className="mt-6">
          <h3 className="font-semibold mb-2">Recent Orders (ASC)</h3>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left border-b"><th className="p-2">Seq</th><th className="p-2">Order #</th><th className="p-2">Date</th><th className="p-2">Customer</th><th className="p-2">Total</th></tr></thead>
              <tbody>
                {recentOrders.map((o, idx) => (
                  <tr key={o.id} className="border-b">
                    <td className="p-2">{idx + 1}</td>
                    <td className="p-2">{o.orderCode || o.id}</td>
                    <td className="p-2">{o.date}</td>
                    <td className="p-2"><OrderCustomerName id={o.customerId} /></td>
                    <td className="p-2">{formatTHB(o.total)}</td>
                  </tr>
                ))}
                {recentOrders.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={5}>No orders yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section title="Browse Orders by Month → Day" right={selectedDay ? <div className="text-sm">Total for {selectedDay}: <b>{formatTHB(dayTotal)}</b></div> : null}>
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
                    <th className="p-2">Total</th>
                    <th className="p-2">Notes</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dayOrders.map((o, idx) => (
                    <tr key={o.id} className="border-b">
                      <td className="p-2">{idx + 1}</td>
                      <td className="p-2">{o.orderCode || o.id}</td>
                      <td className="p-2"><OrderCustomerName id={o.customerId} /></td>
                      <td className="p-2">{formatTHB(o.total)}</td>
                      <td className="p-2">{o.notes || ""}</td>
                      <td className="p-2 flex gap-2">
                        <Button onClick={() => openEdit(o)}>View / Edit</Button>
                        <Button className="bg-red-100" onClick={() => deleteOrder(o)}>Delete</Button>
                      </td>
                    </tr>
                  ))}
                  {selectedDay && dayOrders.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={6}>No orders that day.</td></tr>}
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
              <h3 className="text-lg font-semibold">Edit Order #{editOrder.orderCode || editOrder.id}</h3>
              <Button onClick={()=>setEditOpen(false)}>Close</Button>
            </div>
            <div className="grid grid-cols-12 gap-3 mb-3">
              <div className="col-span-4"><Label>Date</Label><Input type="date" value={editOrder.date} onChange={e=>setEditOrder({...editOrder, date:e.target.value})} /></div>
              <div className="col-span-5"><Label>Customer</Label>
                <Select value={editOrder.customerId} onChange={e=>setEditOrder({...editOrder, customerId:Number(e.target.value)})}>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div className="col-span-3"><Label>Notes</Label><Input value={editOrder.notes||""} onChange={e=>setEditOrder({...editOrder, notes:e.target.value})} /></div>
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
              <div className="text-lg font-semibold">Total: {formatTHB(editTotal)}</div>
              <Button className="bg-green-100" onClick={saveEdit}>Save Changes</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function OrderCustomerName({ id }) {
  const [name, setName] = useState("");
  useEffect(() => { let ok = true; db.customers.get(id).then(c => ok && setName(c?.name || "")); return () => { ok = false; }; }, [id]);
  return <span>{name}</span>;
}

/* =====================================
   Invoices (new tab) — pick month/day/order and generate PDF
===================================== */
function Invoices() {
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [days, setDays] = useState([]);
  const [selectedDay, setSelectedDay] = useState("");
  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(0);
  const [items, setItems] = useState([]);
  const [orderInfo, setOrderInfo] = useState(null);
  const [customer, setCustomer] = useState(null);

  useEffect(() => {
    (async () => {
      const all = await db.orders.orderBy("date").reverse().toArray();
      const ms = Array.from(new Set(all.map(o => monthKey(o.date)))).filter(Boolean);
      setMonths(ms);
      if (ms[0]) setSelectedMonth(ms[0]);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!selectedMonth) { setDays([]); setSelectedDay(""); return; }
      const list = await db.orders.where("date").between(`${selectedMonth}-00`, `${selectedMonth}-99`).toArray();
      const uniqDays = Array.from(new Set(list.map(o => o.date))).sort((a, b) => b.localeCompare(a));
      setDays(uniqDays);
      if (uniqDays[0]) setSelectedDay(uniqDays[0]);
    })();
  }, [selectedMonth]);

  useEffect(() => {
    (async () => {
      if (!selectedDay) { setOrders([]); setSelectedOrderId(0); return; }
      const all = await db.orders.toArray();
      const list = all.filter(o => o.date === selectedDay).sort((a,b)=>a.id-b.id);
      setOrders(list);
      setSelectedOrderId(list[0]?.id || 0);
    })();
  }, [selectedDay]);

  useEffect(() => {
    (async () => {
      if (!selectedOrderId) { setItems([]); setOrderInfo(null); setCustomer(null); return; }
      const o = await db.orders.get(selectedOrderId);
      const its = await db.orderItems.where({ orderId: selectedOrderId }).toArray();
      const mapped = [];
      for (const it of its) {
        const p = await db.products.get(it.productId);
        mapped.push({ name: p?.name || "", qty: it.qty, price: it.price, total: (it.qty * it.price) });
      }
      const cust = await db.customers.get(o.customerId);
      setOrderInfo(o);
      setItems(mapped);
      setCustomer(cust);
    })();
  }, [selectedOrderId]);

  function downloadInvoice() {
    if (!orderInfo) return;
    const doc = new jsPDF();
    const title = "Selera Malaysia Bangkok — Invoice";
    doc.setFontSize(16);
    doc.text(title, 14, 16);
    doc.setFontSize(11);
    doc.text(`Order: ${orderInfo.orderCode || orderInfo.id}`, 14, 24);
    doc.text(`Date: ${orderInfo.date}`, 14, 30);
    if (customer) {
      doc.text(`Customer: ${customer.name}`, 14, 36);
      const addr = [customer.phone, customer.address].filter(Boolean).join(" | ");
      if (addr) doc.text(addr, 14, 42);
    }

    autoTable(doc, {
      startY: 48,
      head: [['Item', 'Qty', 'Unit Price', 'Line Total']],
      body: items.map(it => [it.name, String(it.qty), String(it.price), String((it.total).toFixed(2))]),
      theme: 'grid',
      styles: { fontSize: 11 },
      headStyles: { fillColor: [230,230,230] },
    });

    const finalY = doc.lastAutoTable.finalY || 48;
    doc.setFontSize(12);
    doc.text(`Notes: ${orderInfo.notes || "-"}`, 14, finalY + 10);
    doc.setFontSize(14);
    doc.text(`Total: ${formatTHB(orderInfo.total)}`, 14, finalY + 20);

    doc.save(`invoice_${orderInfo.orderCode || orderInfo.id}.pdf`);
  }

  return (
    <Section title="Invoices — Generate PDF">
      <div className="grid grid-cols-12 gap-4 mb-4">
        <div className="col-span-4">
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
        <div className="col-span-4">
          <Label>Day</Label>
          <div className="flex flex-wrap gap-2">
            {days.map(d => <Button key={d} className={selectedDay === d ? "bg-blue-100":""} onClick={()=>setSelectedDay(d)}>{d}</Button>)}
          </div>
        </div>
        <div className="col-span-4">
          <Label>Order</Label>
          <Select value={selectedOrderId} onChange={e=>setSelectedOrderId(Number(e.target.value))}>
            {orders.map(o => <option key={o.id} value={o.id}>{o.orderCode || o.id} — {formatTHB(o.total)}</option>)}
          </Select>
        </div>
      </div>

      <div className="overflow-auto mb-3">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left border-b"><th className="p-2">Item</th><th className="p-2">Qty</th><th className="p-2">Unit Price</th><th className="p-2">Line Total</th></tr></thead>
          <tbody>
            {items.map((it,i)=>(
              <tr key={i} className="border-b">
                <td className="p-2">{it.name}</td>
                <td className="p-2">{it.qty}</td>
                <td className="p-2">{formatTHB(it.price)}</td>
                <td className="p-2">{formatTHB(it.total)}</td>
              </tr>
            ))}
            {items.length===0 && <tr><td className="p-2 text-gray-500" colSpan={4}>No items for selected order.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button className="bg-green-100" onClick={downloadInvoice} disabled={!orderInfo}>Download PDF</Button>
      </div>
    </Section>
  );
}

/* =====================================
   Settings (Import / Export & Backup)
===================================== */
function Settings() {
  const [mode, setMode] = useState("products");
  const [example, setExample] = useState(() => toCSV([["name","price"],["Rendang",120],["Lemang",180]]));

  useEffect(() => {
    if (mode === "products") setExample(toCSV([["name","price"],["Rendang",120],["Lemang",180]]));
    if (mode === "customers") setExample(toCSV([["name","phone","address","grabwin","grabcar","nationality"],["Nongnute","0812345678","Bangkok","","","TH"]]));
    if (mode === "backup") setExample("{ products: [...], customers: [...], orders: [...], orderItems: [...] } JSON");
  }, [mode]);

  function downloadSample(which) {
    if (which === "products") {
      const csv = toCSV([["name","price"],["Nasi Lemak",60],["Kuih Bingka Ubi",35],["Apam Balik",45]]);
      downloadText("products_sample.csv", csv);
    } else {
      const csv = toCSV([["name","phone","address","grabwin","grabcar","nationality"],["Nongnute","0812345678","Bangkok","","","TH"],["Walk-in","","","","",""]]);
      downloadText("customers_sample.csv", csv);
    }
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    if (mode === "backup") {
      const data = JSON.parse(text);
      await db.transaction("rw", db.products, db.customers, db.orders, db.orderItems, async () => {
        await Promise.all([db.products.clear(), db.customers.clear(), db.orders.clear(), db.orderItems.clear()]);
        if (data.products?.length) await db.products.bulkAdd(data.products);
        if (data.customers?.length) await db.customers.bulkAdd(data.customers);
        if (data.orders?.length) await db.orders.bulkAdd(data.orders);
        if (data.orderItems?.length) await db.orderItems.bulkAdd(data.orderItems);
      });
      alert("Backup restored");
      return;
    }
    const rows = parseCSV(text);
    const [header, ...body] = rows;
    if (!header || body.length === 0) return alert("No rows detected");

    if (mode === "products") {
      const hmap = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
      const toNum = v => Number(String(v).replace(/[, \t]/g, "")) || 0;
      const clean = body.map(r => ({ name: r[hmap.name] || "", price: toNum(r[hmap.price]) })).filter(x => x.name);
      await db.products.bulkAdd(clean);
      alert(`Imported ${clean.length} products`);
    } else if (mode === "customers") {
      const hmap = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
      const clean = body.map(r => ({
        name: r[hmap.name] || "",
        phone: r[hmap.phone] || "",
        address: r[hmap.address] || "",
        grabwin: r[hmap.grabwin] || "",
        grabcar: r[hmap.grabcar] || "",
        nationality: r[hmap.nationality] || "",
      })).filter(x => x.name);
      await db.customers.bulkAdd(clean);
      alert(`Imported ${clean.length} customers`);
    }
  }

  async function exportBackup() {
    const [products, customers, orders, orderItems] = await Promise.all([
      db.products.toArray(), db.customers.toArray(), db.orders.toArray(), db.orderItems.toArray()
    ]);
    downloadText("smb_local_backup.json", JSON.stringify({ products, customers, orders, orderItems }, null, 2));
  }

  return (
    <Section title="Settings (Import / Export & Backup)" right={<Button onClick={exportBackup}>Export Full Backup (JSON)</Button>}>
      <div className="flex flex-wrap gap-2 mb-3">
        <Button className={mode==="products"?"bg-blue-100":""} onClick={()=>setMode("products")}>Products CSV</Button>
        <Button className={mode==="customers"?"bg-blue-100":""} onClick={()=>setMode("customers")}>Customers CSV</Button>
        <Button className={mode==="backup"?"bg-blue-100":""} onClick={()=>setMode("backup")}>Backup JSON</Button>
        {mode!=="backup" && <Button onClick={()=>downloadSample(mode)}>Download Sample CSV</Button>}
      </div>
      <div className="mb-2"><input type="file" accept={mode==="backup"?".json":".csv"} onChange={onFile} /></div>
      <div className="text-sm text-gray-600 mb-1">Example format:</div>
      <pre className="p-3 bg-gray-50 rounded-xl overflow-auto text-xs border">{example}</pre>
    </Section>
  );
}

/* =====================================
   Products
===================================== */
function Products() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", price: "" });
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({ name: "", price: 0 });

  useEffect(() => { db.products.orderBy("name").toArray().then(setList); }, []);
  const filtered = useFuzzy(list, ["name"], q);
  const refresh = async () => setList(await db.products.orderBy("name").toArray());

  async function add() {
    if (!form.name) return alert("Name required");
    await db.products.add({ name: form.name, price: Number(form.price || 0) });
    setForm({ name: "", price: "" });
    refresh();
  }
  function startEdit(p) { setEditId(p.id); setEditDraft({ name: p.name ?? "", price: p.price ?? 0 }); }
  async function saveEdit(id) { await db.products.update(id, { name: editDraft.name ?? "", price: Number(editDraft.price || 0) }); setEditId(null); refresh(); }
  async function remove(id) { if (confirm("Delete product?")) { await db.products.delete(id); refresh(); } }

  return (
    <Section title="Products" right={<Input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} style={{width:240}} />}>
      <div className="grid grid-cols-12 gap-3 mb-4">
        <div className="col-span-8"><Label>Name</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div>
        <div className="col-span-2"><Label>Price</Label><Input type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} /></div>
        <div className="col-span-2 flex items=end"><Button className="w-full" onClick={add}>Add</Button></div>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left border-b"><th className="p-2">Name</th><th className="p-2">Price</th><th className="p-2">Actions</th></tr></thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className="border-b hover:bg-gray-50">
                <td className="p-2">{editId===p.id ? <Input value={editDraft.name} onChange={e=>setEditDraft({...editDraft,name:e.target.value})} /> : p.name}</td>
                <td className="p-2">{editId===p.id ? <Input type="number" value={editDraft.price} onChange={e=>setEditDraft({...editDraft,price:e.target.value})} /> : formatTHB(p.price)}</td>
                <td className="p-2 flex gap-2">
                  {editId===p.id ? <><Button onClick={()=>saveEdit(p.id)}>Save</Button><Button onClick={()=>setEditId(null)}>Cancel</Button></>
                  : <><Button onClick={()=>startEdit(p)}>Edit</Button><Button onClick={()=>remove(p.id)}>Delete</Button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/* =====================================
   Customers
===================================== */
function Customers() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", address: "", grabwin: "", grabcar: "", nationality: "" });
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({ name: "", phone: "", address: "", grabwin: "", grabcar: "", nationality: "" });

  useEffect(() => { db.customers.orderBy("name").toArray().then(setList); }, []);
  const filtered = useFuzzy(list, ["name","phone","address","grabwin","grabcar","nationality"], q);
  const refresh = async () => setList(await db.customers.orderBy("name").toArray());

  async function add() {
    if (!form.name) return alert("Name required");
    await db.customers.add(form);
    setForm({ name: "", phone: "", address: "", grabwin: "", grabcar: "", nationality: "" });
    refresh();
  }
  function startEdit(c) { setEditId(c.id); setEditDraft({ name: c.name ?? "", phone: c.phone ?? "", address: c.address ?? "", grabwin: c.grabwin ?? "", grabcar: c.grabcar ?? "", nationality: c.nationality ?? "" }); }
  async function saveEdit(id) { await db.customers.update(id, editDraft); setEditId(null); refresh(); }
  async function remove(id) { if (confirm("Delete customer?")) { await db.customers.delete(id); refresh(); } }

  return (
    <Section title="Customers" right={<Input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} style={{width:240}} />}>
      <div className="grid grid-cols-12 gap-3 mb-4">
        <div className="col-span-3"><Label>Name</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div>
        <div className="col-span-2"><Label>Phone</Label><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></div>
        <div className="col-span-3"><Label>Address</Label><Input value={form.address} onChange={e=>setForm({...form,address:e.target.value})} /></div>
        <div className="col-span-1"><Label>GrabWin</Label><Input value={form.grabwin} onChange={e=>setForm({...form,grabwin:e.target.value})} /></div>
        <div className="col-span-1"><Label>GrabCar</Label><Input value={form.grabcar} onChange={e=>setForm({...form,grabcar:e.target.value})} /></div>
        <div className="col-span-2"><Label>Nationality</Label><Input value={form.nationality} onChange={e=>setForm({...form,nationality:e.target.value})} /></div>
        <div className="col-span-2 flex items=end"><Button className="w-full" onClick={add}>Add</Button></div>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left border-b">
            <th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2">Address</th><th className="p-2">GrabWin</th><th className="p-2">GrabCar</th><th className="p-2">Nationality</th><th className="p-2">Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="border-b hover:bg-gray-50">
                <td className="p-2">{editId===c.id ? <Input value={editDraft.name} onChange={e=>setEditDraft({...editDraft,name:e.target.value})} /> : c.name}</td>
                <td className="p-2">{editId===c.id ? <Input value={editDraft.phone} onChange={e=>setEditDraft({...editDraft,phone:e.target.value})} /> : c.phone}</td>
                <td className="p-2">{editId===c.id ? <Input value={editDraft.address} onChange={e=>setEditDraft({...editDraft,address:e.target.value})} /> : c.address}</td>
                <td className="p-2">{editId===c.id ? <Input value={editDraft.grabwin} onChange={e=>setEditDraft({...editDraft,grabwin:e.target.value})} /> : c.grabwin}</td>
                <td className="p-2">{editId===c.id ? <Input value={editDraft.grabcar} onChange={e=>setEditDraft({...editDraft,grabcar:e.target.value})} /> : c.grabcar}</td>
                <td className="p-2">{editId===c.id ? <Input value={editDraft.nationality} onChange={e=>setEditDraft({...editDraft,nationality:e.target.value})} /> : c.nationality}</td>
                <td className="p-2 flex gap-2">
                  {editId===c.id ? <><Button onClick={()=>saveEdit(c.id)}>Save</Button><Button onClick={()=>setEditId(null)}>Cancel</Button></>
                  : <><Button onClick={()=>startEdit(c)}>Edit</Button><Button onClick={()=>remove(c.id)}>Delete</Button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/* =====================================
   App Shell
===================================== */
const Tabs = { DASHBOARD: "Dashboard", ORDERS: "Orders", PRODUCTS: "Products", CUSTOMERS: "Customers", INVOICES: "Invoices", SETTINGS: "Settings" };

export default function App() {
  const [tab, setTab] = useState(Tabs.DASHBOARD);
  useEffect(() => { ensureSeed(); }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="font-bold text-lg">Selera Malaysia Bangkok Inventory and Ordering Portal</div>
          <nav className="flex gap-2">
            {Object.values(Tabs).map(t => (
              <Button key={t} className={tab===t ? "bg-blue-100" : ""} onClick={()=>setTab(t)}>{t}</Button>
            ))}
          </nav>
        </div>
      </header>
      <main className="px-5 pb-10">
        {tab===Tabs.DASHBOARD && <Dashboard />}
        {tab===Tabs.ORDERS && <OrderBuilder />}
        {tab===Tabs.PRODUCTS && <Products />}
        {tab===Tabs.CUSTOMERS && <Customers />}
        {tab===Tabs.INVOICES && <Invoices />}
        {tab===Tabs.SETTINGS && <Settings />}
      </main>
      <style>{`table { border-collapse: collapse; } th, td { border-color: #e5e7eb; }`}</style>
    </div>
  );
}
