import React, { useEffect, useState } from "react";
import { listMonths, listDaysInMonth, listOrdersByDate, listCustomers } from "../api";
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
const Select = ({ className = "", children, ...props }) => (
  <select className={`px-3 py-2 rounded-xl border w-full focus:outline-none focus:ring ${className}`} {...props}>{children}</select>
);
const Label = ({ children }) => (<label className="text-sm text-gray-600">{children}</label>);

export default function Invoices() {
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [days, setDays] = useState([]);
  const [selectedDay, setSelectedDay] = useState("");
  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(0);
  const [customers, setCustomers] = useState([]);

  useEffect(() => { listMonths().then(setMonths).catch(console.error); listCustomers().then(setCustomers).catch(console.error); }, []);
  useEffect(() => {
    if (!selectedMonth) { setDays([]); setSelectedDay(""); return; }
    listDaysInMonth(selectedMonth).then(setDays).catch(console.error);
  }, [selectedMonth]);
  useEffect(() => {
    if (!selectedDay) { setOrders([]); setSelectedOrderId(0); return; }
    listOrdersByDate(selectedDay).then((o)=>{ setOrders(o); setSelectedOrderId(o[0]?.id||0); }).catch(console.error);
  }, [selectedDay]);

  async function download() {
    const order = orders.find(o => o.id === Number(selectedOrderId));
    if (!order) return;
    const customer = customers.find(c => c.id === order.customerId);
    await generateInvoicePDF(order, customer);
  }

  return (
    <Section title="Invoices — Generate PDF from an order">
      <div className="grid grid-cols-12 gap-4 mb-4">
        <div className="col-span-12 sm:col-span-4">
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
        <div className="col-span-12 sm:col-span-4">
          <Label>Day</Label>
          <div className="flex flex-wrap gap-2">
            {days.map(d => <Button key={d} className={selectedDay === d ? "bg-blue-100":""} onClick={()=>setSelectedDay(d)}>{d}</Button>)}
          </div>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <Label>Order</Label>
          <Select value={selectedOrderId} onChange={e=>setSelectedOrderId(Number(e.target.value))}>
            {orders.map(o => <option key={o.id} value={o.id}>{o.orderCode} — ฿{Number(o.total || 0).toFixed(2)}</option>)}
          </Select>
        </div>
      </div>
      <div className="flex justify-end">
        <Button className="bg-green-100" onClick={download} disabled={!selectedOrderId}>Download PDF</Button>
      </div>
    </Section>
  );
}
