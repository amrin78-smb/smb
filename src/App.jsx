
import React, { useEffect, useMemo, useState } from "react";
import Dexie from "https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* =====================================
   Dexie (IndexedDB) database
===================================== */
const db = new Dexie("smb_local_orders_db");

/**
 * v1: base
 * v2: add orderCode
 * v3: add deliveryFee
 */
db.version(1).stores({
  products: "++id,name,price",
  customers: "++id,name,phone,address,grabwin,grabcar,nationality",
  orders: "++id,date,customerId,total,notes",
  orderItems: "++id,orderId,productId,qty,price",
});
db.version(2).stores({
  products: "++id,name,price",
  customers: "++id,name,phone,address,grabwin,grabcar,nationality",
  orders: "++id,date,customerId,total,notes,orderCode",
  orderItems: "++id,orderId,productId,qty,price",
}).upgrade(async (tx) => {
  const orders = await tx.table("orders").toArray();
  for (const o of orders) {
    if (!o.orderCode) {
      const code = await generateOrderCode(o.date, tx);
      await tx.table("orders").update(o.id, { orderCode: code });
    }
  }
});
db.version(3).stores({
  products: "++id,name,price",
  customers: "++id,name,phone,address,grabwin,grabcar,nationality",
  orders: "++id,date,customerId,total,deliveryFee,notes,orderCode",
  orderItems: "++id,orderId,productId,qty,price",
}).upgrade(async (tx) => {
  const orders = await tx.table("orders").toArray();
  for (const o of orders) {
    if (typeof o.deliveryFee === "undefined") {
      await tx.table("orders").update(o.id, { deliveryFee: 0 });
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
      { name: "Ice", phone: "080-333-4444", address: "Bangkok", grabwin: "", grabcar: "", nationality: "TH" },
    ]);
  }
}

/* =====================================
   Utils
===================================== */
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthKey = (d) => (d || "").slice(0, 7);
const formatTHB = (n) => new Intl.NumberFormat("en-TH", { style: "currency", currency: "THB" }).format(Number(n || 0));

function ddmmyy(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}${m}${y.slice(2)}`;
}
async function generateOrderCode(dateStr, tx) {
  const t = tx ? tx.table("orders") : db.orders;
  const sameDay = await t.where("date").equals(dateStr).toArray();
  return `${ddmmyy(dateStr)}_${sameDay.length + 1}`;
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
  const [todayOrders, setTodayOrders] = useState([]);

  useEffect(() => {
    (async () => {
      await ensureSeed();
      const orders = await db.orders.where("date").equals(todayStr()).toArray();
      orders.sort((a, b) => a.id - b.id);
      setTodayOrders(orders);
    })();
  }, []);

  const totals = useMemo(() => {
    let revenue = 0;
    todayOrders.forEach((o) => {
      revenue += Number(o.total || 0) + Number(o.deliveryFee || 0);
    });
    return { orders: todayOrders.length, revenue };
  }, [todayOrders]);

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
              <th className="p-2">Delivery Fee</th>
              <th className="p-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {todayOrders.map((o) => <DashboardRow key={o.id} order={o} />)}
            {todayOrders.length === 0 && <tr><td colSpan={5} className="p-2 text-gray-500">No orders yet today.</td></tr>}
          </tbody>
        </table>
      </Section>

      <Section title="How to use">
        <ul className="list-disc pl-6 text-sm text-gray-700 space-y-1">
          <li>Use <b>Orders</b> to create and review orders. Same customer + same date is consolidated.</li>
          <li>Manage <b>Products</b> and <b>Customers</b>.</li>
          <li>Import/Export CSV and backups in <b>Settings</b>.</li>
          <li>All data is stored locally (IndexedDB via Dexie). No internet database.</li>
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
function DashboardRow({ order }) {
  const [custName, setCustName] = useState("");
  useEffect(() => { db.customers.get(order.customerId).then(c => setCustName(c?.name || "")); }, [order.customerId]);
  return (
    <tr className="border-b">
      <td className="p-2">{order.orderCode || order.id}</td>
      <td className="p-2">{custName}</td>
      <td className="p-2">{formatTHB(order.total)}</td>
      <td className="p-2">{formatTHB(order.deliveryFee)}</td>
      <td className="p-2">{formatTHB(Number(order.total || 0) + Number(order.deliveryFee || 0))}</td>
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
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");

  // lists
  const [recentOrders, setRecentOrders] = useState([]);
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [days, setDays] = useState([]);
  const [selectedDay, setSelectedDay] = useState("");
  const [dayOrders, setDayOrders] = useState([]);
  const [dayDetails, setDayDetails] = useState({}); // orderId -> items
  const daySubtotal = useMemo(() => dayOrders.reduce((s,o)=>s + Number(o.total||0), 0), [dayOrders]);
  const dayDelivery = useMemo(() => dayOrders.reduce((s,o)=>s + Number(o.deliveryFee||0), 0), [dayOrders]);
  const dayGrand = useMemo(() => daySubtotal + dayDelivery, [daySubtotal, dayDelivery]);

  // edit modal
  const [editOpen,setEditOpen]=useState(false);
  const [editOrder,setEditOrder]=useState(null);
  const [editItems,setEditItems]=useState([]);
  const [editTotal,setEditTotal]=useState(0);
  const [editDeliveryFee,setEditDeliveryFee]=useState(0);
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
      if (!selectedMonth) { setDays([]); setSelectedDay(""); setDayOrders([]); setDayDetails({}); return; }
      const list = await db.orders.where("date").between(`${selectedMonth}-00`, `${selectedMonth}-99`).toArray();
      const uniqDays = Array.from(new Set(list.map(o => o.date))).sort((a, b) => b.localeCompare(a));
      setDays(uniqDays);
      if (uniqDays[0]) setSelectedDay(uniqDays[0]);
    })();
  }, [selectedMonth]);

  useEffect(() => {
    (async () => {
      if (!selectedDay) { setDayOrders([]); setDayDetails({}); return; }
      const all = await db.orders.toArray();
      const list = all.filter(o => o.date === selectedDay).sort((a,b)=>a.id-b.id);
      setDayOrders(list);

      // fetch items for each order to display details
      const details = {};
      for (const o of list) {
        details[o.id] = await loadItemsForOrder(o.id);
      }
      setDayDetails(details);
    })();
  }, [selectedDay]);

  async function loadItemsForOrder(orderId){
    const its = await db.orderItems.where({ orderId }).toArray();
    const withNames = [];
    for (const it of its) {
      const p = await db.products.get(it.productId);
      withNames.push({ ...it, name: p?.name || "(deleted)" });
    }
    return withNames;
  }

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

  // Save order (consolidate by customer + date)
  async function saveOrder() {
    try {
      if (!customerId) return alert("Select a customer");
      if (items.length === 0) return alert("Add at least one item");

      const custId = Number(customerId);
      const existing = await db.orders.where("date").equals(date).and(o => o.customerId === custId).first();

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
          await db.orders.update(existing.id, { total: newTotal, notes: newNotes, deliveryFee: Number(deliveryFee || 0) });
        });
        await afterSaveRefresh(date);
        setItems([]);
        alert(`Order consolidated into #${existing.orderCode || existing.id}`);
        return;
      }

      const orderCode = await generateOrderCode(date);
      const oid = await db.orders.add({ date, customerId: custId, total, deliveryFee: Number(deliveryFee || 0), notes, orderCode });
      await db.orderItems.bulkAdd(items.map(it => ({ orderId: oid, productId: it.productId, qty: Number(it.qty), price: Number(it.price) })));
      await afterSaveRefresh(date);
      setItems([]);
      setDeliveryFee(0);
      alert(`Order saved as #${orderCode}`);
    } catch (err) {
      console.error(err);
      alert("Failed to save order: " + (err?.message || String(err)));
    }
  }

  async function afterSaveRefresh(focusDate){
    // refresh recent list
    setRecentOrders(await db.orders.orderBy("id").toArray());
    // update calendars
    const m = monthKey(focusDate);
    const inMonth = await db.orders.where("date").between(`${m}-00`, `${m}-99`).toArray();
    const newDays = Array.from(new Set(inMonth.map(o => o.date))).sort((a,b)=>b.localeCompare(a));
    setMonths(prev => (prev.includes(m) ? prev : [m, ...prev]));
    setDays(newDays);
    setSelectedMonth(m);
    setSelectedDay(focusDate);
    // refresh day orders + details
    const list = await db.orders.where("date").equals(focusDate).toArray();
    list.sort((a,b)=>a.id-b.id);
    setDayOrders(list);
    const details = {};
    for (const o of list) details[o.id] = await loadItemsForOrder(o.id);
    setDayDetails(details);
  }

  async function exportOrdersCSV() {
    const rows = [["OrderCode","Date","Customer","Subtotal","DeliveryFee","Item","Qty","UnitPrice","LineTotal","Notes"]];
    const orders = await db.orders.orderBy("id").toArray();
    for (const o of orders) {
      const cust = await db.customers.get(o.customerId);
      const its = await db.orderItems.where({ orderId: o.id }).toArray();
      if (its.length === 0) {
        rows.push([o.orderCode || o.id, o.date, cust?.name || "", o.total || 0, o.deliveryFee || 0, "", "", "", "", o.notes || ""]);
      } else {
        for (const it of its) {
          const p = await db.products.get(it.productId);
          rows.push([o.orderCode || o.id, o.date, cust?.name || "", o.total || 0, o.deliveryFee || 0, p?.name || "", it.qty, it.price, (it.qty * it.price).toFixed(2), o.notes || ""]);
        }
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
    setEditDeliveryFee(Number(order.deliveryFee || 0));
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
        await db.orders.update(editOrder.id, { date:editOrder.date, customerId:Number(editOrder.customerId), notes:editOrder.notes||"", total:editTotal, deliveryFee:Number(editDeliveryFee||0) });
        const existing = await db.orderItems.where({orderId:editOrder.id}).primaryKeys();
        if(existing.length) await db.orderItems.bulkDelete(existing);
        await db.orderItems.bulkAdd(editItems.map(it=>({ orderId:editOrder.id, productId:it.productId, qty:Number(it.qty), price:Number(it.price) })));
      });
      setEditOpen(false);
      await afterSaveRefresh(editOrder.date);
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
    await afterSaveRefresh(order.date);
  }

  // ===== UI =====
  return (
    <>
      <Section title="Create Order" right={<Button onClick={exportOrdersCSV}>Export Orders CSV</Button>}>
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
          <div className="text-lg font-semibold">Subtotal: {formatTHB(total)} &nbsp;•&nbsp; Delivery: {formatTHB(deliveryFee)} &nbsp;•&nbsp; Total: {formatTHB(Number(total)+Number(deliveryFee||0))}</div>
          <Button className="bg-green-100" onClick={saveOrder}>Save Order</Button>
        </div>

        <div className="mt-6">
          <h3 className="font-semibold mb-2">Recent Orders (ASC)</h3>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left border-b"><th className="p-2">Seq</th><th className="p-2">Order #</th><th className="p-2">Date</th><th className="p-2">Customer</th><th className="p-2">Subtotal</th><th className="p-2">Delivery</th><th className="p-2">Total</th></tr></thead>
              <tbody>
                {recentOrders.map((o, idx) => (
                  <tr key={o.id} className="border-b">
                    <td className="p-2">{idx + 1}</td>
                    <td className="p-2">{o.orderCode || o.id}</td>
                    <td className="p-2">{o.date}</td>
                    <td className="p-2"><OrderCustomerName id={o.customerId} /></td>
                    <td className="p-2">{formatTHB(o.total)}</td>
                    <td className="p-2">{formatTHB(o.deliveryFee)}</td>
                    <td className="p-2">{formatTHB(Number(o.total||0)+Number(o.deliveryFee||0))}</td>
                  </tr>
                ))}
                {recentOrders.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={7}>No orders yet.</td></tr>}
              </tbody>
            </table>
          </div>
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
                        <td className="p-2">{o.orderCode || o.id}</td>
                        <td className="p-2"><OrderCustomerName id={o.customerId} /></td>
                        <td className="p-2">{formatTHB(o.total)}</td>
                        <td className="p-2">{formatTHB(o.deliveryFee)}</td>
                        <td className="p-2">{formatTHB(Number(o.total||0)+Number(o.deliveryFee||0))}</td>
                        <td className="p-2">{o.notes || ""}</td>
                        <td className="p-2 flex gap-2">
                          <Button onClick={() => openEdit(o)}>View / Edit</Button>
                          <Button className="bg-red-100" onClick={() => deleteOrder(o)}>Delete</Button>
                          <Button onClick={() => downloadInvoiceForOrder(o)}>Invoice PDF</Button>
                        </td>
                      </tr>
                      <tr className="bg-gray-50">
                        <td className="p-2 text-gray-500" colSpan={8}>
                          <div className="text-xs uppercase tracking-wide mb-1">Items</div>
                          {(dayDetails[o.id] || []).length === 0 && <div className="text-sm text-gray-500">No items.</div>}
                          {(dayDetails[o.id] || []).length > 0 && (
                            <div className="flex flex-wrap gap-3">
                              {(dayDetails[o.id] || []).map((it, i) => (
                                <div key={i} className="px-2 py-1 rounded-lg border bg-white">
                                  {it.name} &times; {it.qty} @ {formatTHB(it.price)} = <b>{formatTHB(it.qty*it.price)}</b>
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
              <h3 className="text-lg font-semibold">Edit Order #{editOrder.orderCode || editOrder.id}</h3>
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
              <div className="text-lg font-semibold">Subtotal: {formatTHB(editTotal)} &nbsp;•&nbsp; Delivery: {formatTHB(editDeliveryFee)} &nbsp;•&nbsp; Total: {formatTHB(Number(editTotal)+Number(editDeliveryFee||0))}</div>
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
async function downloadInvoiceForOrder(order){
  try{
    await generateInvoice(order);
  }catch(e){
    console.error(e);
    alert("Failed to generate invoice: " + (e?.message || String(e)));
  }
}

/* =====================================
   Invoices (tab) — optional picker view
===================================== */
function Invoices() {
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [days, setDays] = useState([]);
  const [selectedDay, setSelectedDay] = useState("");
  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(0);

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

  async function download(){
    if(!selectedOrderId) return;
    const order = await db.orders.get(selectedOrderId);
    await downloadInvoiceForOrder(order);
  }

  return (
    <Section title="Invoices — Generate PDF from an order">
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
            {orders.map(o => <option key={o.id} value={o.id}>{o.orderCode || o.id} — {formatTHB(Number(o.total||0)+Number(o.deliveryFee||0))}</option>)}
          </Select>
        </div>
      </div>
      <div className="flex justify-end">
        <Button className="bg-green-100" onClick={download} disabled={!selectedOrderId}>Download PDF</Button>
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
   Invoice generation (jsPDF + AutoTable)
===================================== */
async function getBase64FromUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
async function generateInvoice(order) {
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();

  // Logo (top-right)
  try {
    const logoData = await getBase64FromUrl("/logo.png");
    doc.addImage(logoData, "PNG", pageWidth - 50, 10, 40, 25);
  } catch (e) {
    // ignore if logo fails
  }

  // Header
  doc.setFontSize(20);
  doc.text("INVOICE", 14, 20);

  // Business info
  doc.setFontSize(11);
  doc.text("Selera Malaysia Bangkok", 14, 30);
  doc.text("Phone: +66 9 8284 1569", 14, 36);

  // Customer
  const cust = await db.customers.get(order.customerId);
  let y = 50;
  doc.setFontSize(12);
  doc.text("Bill To:", 14, y); y += 6;
  doc.setFontSize(11);
  if (cust?.name) { doc.text(cust.name, 14, y); y += 6; }
  if (cust?.phone) { doc.text("Phone: " + cust.phone, 14, y); y += 6; }
  if (cust?.address) { doc.text("Address: " + cust.address, 14, y); y += 6; }

  // Invoice info
  y = 50;
  doc.text(`Invoice #: ${order.orderCode || order.id}`, pageWidth/2, y); y += 6;
  doc.text(`Date: ${order.date}`, pageWidth/2, y);

  // Items
  const its = await db.orderItems.where({ orderId: order.id }).toArray();
  const rows = [];
  for (const it of its) {
    const p = await db.products.get(it.productId);
    rows.push([p?.name || "", String(it.qty), String(it.price), String((it.qty * it.price).toFixed(2))]);
  }
  autoTable(doc, {
    startY: 90,
    head: [["Description", "Qty", "Unit Price", "Amount"]],
    body: rows,
    styles: { fontSize: 11 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255 }, // blue header
    theme: "grid",
  });

  const finalY = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(12);
  doc.text(`Subtotal: ${formatTHB(order.total)}`, 14, finalY);
  doc.text(`Delivery Fee: ${formatTHB(order.deliveryFee)}`, 14, finalY + 6);
  doc.setFontSize(14);
  doc.text(`TOTAL: ${formatTHB(Number(order.total||0) + Number(order.deliveryFee||0))}`, 14, finalY + 16);

  // Payment info
  const payY = finalY + 30;
  doc.setFontSize(12);
  doc.text("Payment:", 14, payY);
  doc.setFontSize(11);
  doc.text("Krungsri / Bank Ayudhaya : 511 1345 714", 14, payY + 6);
  doc.text("PromptPay: 098 284 1569", 14, payY + 12);

  // Footer
  doc.setFontSize(11);
  doc.text("Thank you for your order!", 14, payY + 24);

  doc.save(`invoice_${order.orderCode || order.id}.pdf`);
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
          <div className="flex items-center gap-4">
            <nav className="flex gap-2">
              {Object.values(Tabs).map(t => (
                <Button key={t} className={tab===t ? "bg-blue-100" : ""} onClick={()=>setTab(t)}>{t}</Button>
              ))}
            </nav>
            <img src="/logo.png" alt="Selera Malaysia Bangkok" className="h-10" />
          </div>
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
