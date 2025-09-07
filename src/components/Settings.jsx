import React, { useState } from "react";
import { createProduct, createCustomer } from "../api";

/* ---------- UI helpers ---------- */
const Section = ({ title, right, children }) => (
  <div className="w-full max-w-6xl mx-auto my-6 p-5 rounded-2xl shadow border bg-white">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="flex items-center gap-2">{right}</div>
    </div>
    {children}
  </div>
);
const Button = ({ children, className = "", ...props }) => (
  <button
    className={`px-3 py-2 rounded-xl border shadow-sm hover:shadow transition text-sm bg-gray-50 ${className}`}
    {...props}
  >
    {children}
  </button>
);

/* ---------- Sample CSVs ---------- */
const SAMPLE_PRODUCTS = `name,price
Apam Balik 1 pc,25
Bubur Kacang Hijau Durian 1 bowl,89
`;
const SAMPLE_CUSTOMERS = `name,phone,address
John Doe,0812345678,23/11 Sukhumvit 15, Bangkok
Amy Tan,0899990000,Thonglor Soi 10, Bangkok
`;
/* Required columns for orders are up to your server importer; this template fits /import-orders */
const SAMPLE_ORDERS = `date,customer,product,qty,price,delivery_fee,notes
2025-09-01,John Doe,Apam Balik 1 pc,5,25,30,No peanuts please
2025-09-01,John Doe,Bubur Kacang Hijau Durian 1 bowl,2,89,30,No peanuts please
2025-09-02,Amy Tan,Apam Balik 1 pc,3,25,0,Leave at lobby
`;

function download(name, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

/* ---------- Robust CSV parsing (handles quotes, commas, newlines) ---------- */
function parseCSV(text) {
  const rows = [];
  let cur = [];
  let val = "";
  let inQ = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];

    if (inQ) {
      if (c === `"` && n === `"`) { val += `"`; i++; continue; }
      if (c === `"`) { inQ = false; continue; }
      val += c;
      continue;
    }
    if (c === `"`) { inQ = true; continue; }
    if (c === ",") { cur.push(val); val = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && n === "\n") i++;
      cur.push(val); rows.push(cur); cur = []; val = "";
      continue;
    }
    val += c;
  }
  if (val.length || cur.length) { cur.push(val); rows.push(cur); }

  // Trim whitespace
  return rows.map(r => r.map(x => (x ?? "").toString().trim()));
}

export default function Settings() {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  async function handleImport(type, file) {
    if (!file) return;
    setBusy(true);
    setLog((p) => p + `Starting import for ${type}...\n`);

    try {
      const text = await file.text();

      if (type === "orders") {
        // Server-side importer returns { created, merged, itemsInserted, ordersProcessed }
        const res = await fetch("/.netlify/functions/import-orders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ csv: text }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(body || "Import failed");
        }
        const data = await res.json();
        setLog((p) => p +
          `Orders import complete ⇒ orders processed: ${data.ordersProcessed ?? 0}, created: ${data.created ?? 0}, merged: ${data.merged ?? 0}, items inserted: ${data.itemsInserted ?? 0}\n`
        );
        window.dispatchEvent(new Event("smb-data-changed"));
        location.reload();
        return;
      }

      // Client-side imports for products/customers
      const rows = parseCSV(text);
      if (!rows.length) throw new Error("Empty CSV");

      const headers = rows.shift().map((h) => h.toLowerCase());
      const idx = (name) => headers.indexOf(name);

      let created = 0, skipped = 0, failed = 0;

      if (type === "products") {
        const iName = idx("name");
        const iPrice = idx("price");
        if (iName === -1) throw new Error(`"name" header not found`);
        if (iPrice === -1) throw new Error(`"price" header not found`);

        for (const r of rows) {
          try {
            const name = r[iName] || "";
            const price = Number(r[iPrice] || 0);
            if (!name) { skipped++; continue; }
            await createProduct({ name, price });
            created++;
          } catch (e) {
            failed++;
            setLog((p) => p + `Product row failed: ${e.message}\n`);
          }
        }
        setLog((p) => p + `Products import complete ⇒ created: ${created}, skipped: ${skipped}, failed: ${failed}\n`);
        window.dispatchEvent(new Event("smb-data-changed"));
        location.reload();
        return;
      }

      if (type === "customers") {
        const iName = idx("name");
        if (iName === -1) throw new Error(`"name" header not found`);
        const iPhone = idx("phone");
        const iAddress = idx("address");

        for (const r of rows) {
          try {
            const name = r[iName] || "";
            if (!name) { skipped++; continue; }
            const phone = iPhone === -1 ? "" : (r[iPhone] || "");
            const address = iAddress === -1 ? "" : (r[iAddress] || "");
            await createCustomer({ name, phone, address });
            created++;
          } catch (e) {
            failed++;
            setLog((p) => p + `Customer row failed: ${e.message}\n`);
          }
        }
        setLog((p) => p + `Customers import complete ⇒ created: ${created}, skipped: ${skipped}, failed: ${failed}\n`);
        window.dispatchEvent(new Event("smb-data-changed"));
        location.reload();
        return;
      }

      throw new Error(`Unknown import type: ${type}`);
    } catch (e) {
      console.error(e);
      setLog((p) => p + `Import failed: ${e.message}\n`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto mt-6">
      {/* PRODUCTS */}
      <Section
        title="Import Products (CSV)"
        right={
          <Button onClick={() => download("products_sample.csv", SAMPLE_PRODUCTS)}>
            Download sample CSV
          </Button>
        }
      >
        <p className="mb-2 text-sm text-gray-600">
          CSV headers required: <b>name,price</b>. If a value contains commas, wrap it in double-quotes.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && handleImport("products", e.target.files[0])}
          disabled={busy}
        />
      </Section>

      {/* CUSTOMERS */}
      <Section
        title="Import Customers (CSV)"
        right={
          <Button onClick={() => download("customers_sample.csv", SAMPLE_CUSTOMERS)}>
            Download sample CSV
          </Button>
        }
      >
        <p className="mb-2 text-sm text-gray-600">
          CSV must include at least <b>name</b>. Optional columns like <b>phone</b> and <b>address</b> will be used if present.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && handleImport("customers", e.target.files[0])}
          disabled={busy}
        />
      </Section>

      {/* ORDERS */}
      <Section
        title="Import Orders (CSV)"
        right={
          <Button onClick={() => download("orders_sample.csv", SAMPLE_ORDERS)}>
            Download sample CSV
          </Button>
        }
      >
        <p className="mb-2 text-sm text-gray-600">
          Upload the orders CSV exported from Excel. The server will group by <b>date + customer</b>, upsert customers/products,
          create/merge orders, and recalculate totals automatically.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && handleImport("orders", e.target.files[0])}
          disabled={busy}
        />
        <div className="mt-3 text-xs text-gray-500">
          Summary shows: <i>orders processed, created, merged, items inserted</i>.
        </div>
      </Section>

      {/* LOGS */}
      <Section title="Logs">
        <pre className="bg-gray-100 p-3 rounded-xl text-sm whitespace-pre-wrap">
          {log || "No imports yet."}
        </pre>
      </Section>
    </div>
  );
}
