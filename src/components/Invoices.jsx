import React, { useEffect, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { listOrdersByDate, getOrder } from "../api";
import { formatTHB, todayStr, getBase64FromUrl } from "../utils/format";

/** Utility: safe date (YYYY-MM-DD) */
function ymd(d) {
  try {
    if (!d) return "";
    const dt = new Date(d);
    return dt.toISOString().slice(0, 10);
  } catch {
    return d || "";
  }
}

/** Generate one invoice PDF for the given order */
async function generateInvoice(order) {
  // Ensure we have items
  let fullOrder = order;
  if (!order.items || !order.items.length) {
    try {
      fullOrder = await getOrder(order.id);
    } catch (e) {
      alert("Unable to load items for this order.");
      return;
    }
  }

  const items = (fullOrder.items || []).map((it) => ({
    name: it.name ?? it.productName ?? "",
    qty: Number(it.qty ?? it.quantity ?? 0),
    price: Number(it.price ?? it.unitPrice ?? 0),
  }));

  // compute money if not provided
  const subtotal =
    fullOrder.subtotal != null
      ? Number(fullOrder.subtotal)
      : items.reduce((s, it) => s + it.qty * it.price, 0);
  const delivery = Number(fullOrder.deliveryFee ?? fullOrder.delivery ?? 0);
  const total = subtotal + delivery;

  // Create doc (pt = more exact spacing)
  const doc = new jsPDF("p", "pt");

  // Try to load logo as Base64 and keep aspect ratio automatically
  try {
    const dataUrl = await getBase64FromUrl("/logo.png");
    // width = 90, height = 0 (auto) -> preserves aspect ratio
    doc.addImage(dataUrl, "PNG", 450, 20, 90, 0);
  } catch {
    /* ignore if logo missing */
  }

  // Header
  doc.setFontSize(18);
  doc.text("INVOICE", 40, 40);

  // Business info
  doc.setFontSize(11);
  doc.text("Selera Malaysia Bangkok", 40, 65);
  doc.text("Phone: +66 9 8284 1569", 40, 82);

  // Bill To
  const billYTop = 120;
  doc.setFont(undefined, "bold");
  doc.text("Bill To:", 40, billYTop);
  doc.setFont(undefined, "normal");
  let lineY = billYTop + 16;
  if (fullOrder.customerName) {
    doc.text(String(fullOrder.customerName), 40, lineY);
    lineY += 16;
  }
  if (fullOrder.customerPhone) {
    doc.text(`Phone: ${fullOrder.customerPhone}`, 40, lineY);
    lineY += 16;
  }
  if (fullOrder.customerAddress) {
    const lines = doc.splitTextToSize(`Address: ${fullOrder.customerAddress}`, 260);
    doc.text(lines, 40, lineY);
  }

  // Invoice meta (right side)
  const metaX = 380;
  doc.setFont(undefined, "normal");
  doc.text(`Invoice #: ${fullOrder.orderCode || fullOrder.code || fullOrder.id}`, metaX, billYTop);
  doc.text(`Date: ${ymd(fullOrder.date)}`, metaX, billYTop + 16);

  // Items table
  const headers = [["Description", "Qty", "Unit Price", "Amount"]];
  const body = items.map((it) => [
    it.name,
    String(it.qty),
    `THB ${it.price.toFixed(2)}`,
    `THB ${(it.qty * it.price).toFixed(2)}`,
  ]);

  autoTable(doc, {
    startY: 200,
    head: headers,
    body,
    theme: "grid",
    styles: {
      fontSize: 10,
      lineWidth: 0.5,
      lineColor: [0, 0, 0],
      cellPadding: 6,
    },
    headStyles: {
      fillColor: [0, 51, 153],
      halign: "left",
      fontStyle: "bold",
      textColor: [255, 255, 255],
    },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
    },
  });

  // Totals box
  const y = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 20 : 260;
  doc.setFontSize(11);
  doc.text(`Subtotal: ${formatTHB(subtotal)}`, 40, y);
  doc.text(`Delivery Fee: ${formatTHB(delivery)}`, 40, y + 16);
  doc.setFont(undefined, "bold");
  doc.text(`TOTAL: ${formatTHB(total)}`, 40, y + 36);
  doc.setFont(undefined, "normal");

  // Payment footer
  const fy = y + 70;
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  doc.text("Payment:", 40, fy);
  doc.setFont(undefined, "normal");
  doc.text("Krungsri / Bank Ayudhaya : 511 1345 714", 40, fy + 16);
  doc.text("PromptPay: 098 284 1569", 40, fy + 32);
  doc.text("Thank you for your order!", 40, fy + 56);

  doc.save(`${fullOrder.orderCode || fullOrder.code || "invoice"}.pdf`);
}

export default function Invoices() {
  const [date, setDate] = useState(todayStr());
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const list = await listOrdersByDate(date);
      setOrders(list || []);
    } catch (e) {
      console.error(e);
      alert("Failed to load orders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <div className="max-w-6xl mx-auto mt-4 sm:mt-6">
      <div className="bg-white border rounded-2xl shadow p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-semibold">Invoices</h2>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border rounded-lg px-3 py-1.5"
            />
            <button
              onClick={load}
              className="px-3 py-1.5 border rounded-lg bg-gray-50"
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2 text-left">Order #</th>
                <th className="p-2 text-left">Customer</th>
                <th className="p-2 text-left hidden sm:table-cell">Subtotal</th>
                <th className="p-2 text-left hidden sm:table-cell">Delivery</th>
                <th className="p-2 text-left">Total</th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b align-top">
                  <td className="p-2">{o.orderCode || o.code || o.id}</td>
                  <td className="p-2">
                    <div className="font-medium">{o.customerName ?? o.customerId}</div>
                    <div className="text-xs text-gray-500">{o.customerPhone}</div>
                    <div className="text-xs text-gray-500 truncate max-w-[260px]">
                      {o.customerAddress}
                    </div>
                  </td>
                  <td className="p-2 hidden sm:table-cell">{formatTHB(o.subtotal)}</td>
                  <td className="p-2 hidden sm:table-cell">
                    {formatTHB(o.deliveryFee ?? o.delivery)}
                  </td>
                  <td className="p-2">
                    {formatTHB((o.subtotal ?? 0) + (o.deliveryFee ?? o.delivery ?? 0))}
                  </td>
                  <td className="p-2">
                    <button
                      onClick={() => generateInvoice(o)}
                      className="px-3 py-1.5 rounded-lg border bg-gray-50"
                    >
                      Invoice PDF
                    </button>
                  </td>
                </tr>
              ))}
              {(!orders || orders.length === 0) && (
                <tr>
                  <td colSpan={6} className="p-3 text-gray-500">
                    No orders for {date}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Optional: lightweight item preview per order if items are included */}
        <div className="mt-6 space-y-3">
          {orders.map(
            (o) =>
              Array.isArray(o.items) &&
              o.items.length > 0 && (
                <div key={`preview-${o.id}`} className="text-xs text-gray-700">
                  <div className="font-semibold mb-1">
                    {o.orderCode || o.code || o.id} — Items
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {o.items.map((it, idx) => (
                      <div
                        key={idx}
                        className="px-2 py-1 bg-gray-50 border rounded-lg"
                      >
                        {(it.name ?? it.productName ?? "")} × {it.qty} @ THB{" "}
                        {Number(it.price).toFixed(2)}
                      </div>
                    ))}
                  </div>
                </div>
              )
          )}
        </div>
      </div>
    </div>
  );
}
