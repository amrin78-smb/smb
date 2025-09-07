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

/* ---------- Sample CSVs (download buttons) ---------- */
const SAMPLE_PRODUCTS = `name,price
Apam Balik 1 pc,25
Bubur Kacang Hijau Durian 1 bowl,89
`;

const SAMPLE_CUSTOMERS = `name,phone,address
John Doe,0812345678,23/11 Sukhumvit 15, Bangkok
Amy Tan,0899990000,Thonglor Soi 10, Bangkok
`;

/* Orders importer expects these headers (case-insensitive):
   REQUIRED: date, customerName, productName, qty, price
   OPTIONAL: customerPhone, customerAddress, deliveryFee, notes */
const SAMPLE_ORDERS = `date,customerName,customerPhone,customerAddress,productName,qty,price,deliveryFee,notes
2025-09-01,John Doe,0812345678,23/11 Sukhumvit 15, Apam Balik 1 pc,5,25,30,No peanuts please
2025-09-01,John Doe,0812345678,23/11 Sukhumvit 15, Bubur Kacang Hijau Durian 1 bowl,2,89,30,No peanuts please
2025-09-02,Amy Tan,0899990000,Thonglor Soi 10, Apam Balik 1 pc,3,25,,Leave at lobby
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

/* ---------- Robust CSV parsing (quotes, commas, newlines) ---------- */
function parseCSV(text) {
  const out = [];
  let row = [];
  let val = "";
  let inQ = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];

    if (inQ) {
      if (c === '"' && n === '"') { val += '"'; i++; continue; }
      if (c === '"') { inQ = false; continue; }
      val += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ",") { row.push(val); val = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && n === "\n") i++;
      row.push(val); out.push(row); row = []; val = "";
      continue;
    }
    val += c;
  }
  if (val.length || row.length) { row.push(val); out.push(row); }

  // Trim whitespace
  return out.map(r => r.map(x => (x ?? "").toString().trim()));
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

      /* ----- ORDERS: send array payload to server importer ----- */
      if (type === "orders") {
        const rows = parseCSV(text);
        if (!rows.length) throw new Error("Empty CSV");

        const headers = rows.shift().map(h => String(h || "").toLowerCase());
        const idx = (name) => headers.indexOf(name);

        const iDate   = idx("date");
        const iCName  = idx("customername");
        const iPName  = idx("productname");
        const iQty    = idx("qty");
        const iPrice  = idx("price");

        const missing = [];
        if (iDate  === -1) missing.push("date");
        if (iCName === -1) missing.push("customerName");
        if (iPName === -1) missing.push("productName");
        if (iQty   === -1) missing.push("qty");
        if (iPrice === -1) missing.push("price");
        if (missing.length) throw new Error(`Missing required headers: ${missing.join(", ")}`);

        const iCPhone = idx("customerphone");
        const iCAddr  = idx("customeraddress");
        const iFee    = idx("deliveryfee");
        const iNotes  = idx("notes");

        const payload = rows.map((r) => ({
          date: (r[iDate] || "").slice(0, 10),
          customerName: (r[iCName] || "").trim(),
          customerPhone: iCPhone >= 0 ? (r[iCPhone] || "") : "",
          customerAddress: iCAddr >= 0 ? (r[iCAddr] || "") : "",
          productName: (r[iPName] || "").trim(),
          qty: Number(r[iQty] || 0),
          price: Number(r[iPrice] || 0),
          deliveryFee: iFee >= 0
            ? (r[iFee] === "" || r[iFee] == null ? null : Number(r[iFee]))
            : null,
          notes: iNotes >= 0 ? (r[iNotes] || "") : "",
        }));

        const resp = await fetch("/.netlify/functions/import-orders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(body || "Import failed");
        }

        const data = await resp.json().catch(() => ({}));
        setLog((p) => p +
          `Orders import complete ⇒ orders processed: ${data.ordersProcessed ?? 0}, ` +
          `created: ${data.created ?? 0}, merged: ${data.merged ?? 0}, ` +
          `items inserted: ${data.itemsInserted ?? 0}\n`
        );

        // Refresh UI immediately
        window.dispatchEvent(new Event("smb-data-changed"));
        location.reload();
        return;
      }

      /* ----- PRODUCTS: client-side row-by-row ----- */
      if (type === "products") {
        const rows = parseCSV(text);
        if (!rows.length) throw new Error("Empty CSV");

        const headers = rows.shift().map(h => String(h || "").toLowerCase());
        const idx = (name) => headers.indexOf(name);

        const iName = idx("name");
        const iPrice = idx("price");
        if (iName === -1) throw new Error(`"name" header not found`);
        if (iPrice === -1) throw new Error(`"price" header not found`);

        let created = 0, skipped = 0, failed = 0;

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

      /* ----- CUSTOMERS: client-side row-by-row ----- */
      if (type === "customers") {
        const rows = parseCSV(text);
        if (!rows.length) throw new Error("Empty CSV");

        const headers = rows.shift().map(h => String(h || "").toLowerCase());
        const idx = (name) => headers.indexOf(name);

        const iName = idx("name");
        if (iName === -1) throw new Error(`"name" header not found`);

        const iPhone = idx("phone");
        const iAddress = idx("address");
        const iGrabwin = idx("grabwin");
        const iGrabcar = idx("grabcar");
        const iNationality = idx("nationality");

        let created = 0, skipped = 0, failed = 0;

        for (const r of rows) {
          try {
            const draft = {
              name: r[iName] || "",
              phone: iPhone >= 0 ? r[iPhone] || "" : "",
              address: iAddress >= 0 ? r[iAddress] || "" : "",
              grabwin: iGrabwin >= 0 ? r[iGrabwin] || "" : "",
              grabcar: iGrabcar >= 0 ? r[iGrabcar] || "" : "",
              nationality: iNationality >= 0 ? r[iNationality] || "" : "",
            };
            if (!draft.name) { skipped++; continue; }
            await createCustomer(draft);
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
        right={<Button onClick={() => download("products_sample.csv", SAMPLE_PRODUCTS)}>Download sample CSV</Button>}
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
        right={<Button onClick={() => download("customers_sample.csv", SAMPLE_CUSTOMERS)}>Download sample CSV</Button>}
      >
        <p className="mb-2 text-sm text-gray-600">
          CSV must include at least <b>name</b>. Optional columns like <b>phone</b>, <b>address</b>, <b>grabwin</b>,
          <b className="ml-1">grabcar</b>, and <b className="ml-1">nationality</b> will be used if present.
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
        right={<Button onClick={() => download("orders_sample.csv", SAMPLE_ORDERS)}>Download sample CSV</Button>}
      >
        <p className="mb-2 text-sm text-gray-600">
          Required headers: <b>date, customerName, productName, qty, price</b>. Optional: <b>customerPhone</b>,{" "}
          <b>customerAddress</b>, <b>deliveryFee</b>, <b>notes</b>.
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
