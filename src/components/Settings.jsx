import React, { useState } from "react";
import { createProduct, createCustomer } from "../api";

/* ---------- UI helpers ---------- */
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
  <button
    className={`px-3 py-2 rounded-xl border shadow-sm hover:shadow transition text-sm bg-gray-50 ${className}`}
    {...props}
  >
    {children}
  </button>
);

/* ---------- Robust CSV parsing (handles quotes, commas, newlines) ---------- */
function detectDelimiter(headerLine) {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const c = headerLine.split(d).length;
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

function parseCSVText(text) {
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  // Normalize newlines
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines = text.split("\n");
  const delimiter = detectDelimiter(lines[0] || ",");

  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    rows.push(row.map((c) => (c ?? "").trim()));
    row = [];
  };

  const str = text; // parse entire string char by char
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = str[i + 1];
        if (next === '"') {
          // Escaped quote ""
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      pushCell();
      continue;
    }
    if (ch === "\n") {
      pushCell();
      pushRow();
      continue;
    }
    cell += ch;
  }
  // last cell/row
  pushCell();
  if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
    pushRow();
  }

  // Remove possible trailing blank rows
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  return { rows, delimiter };
}

/* ---------- Component ---------- */
export default function Settings() {
  const [log, setLog] = useState("");
  const [preview, setPreview] = useState(null); // { type, headers, rows }
  const [busy, setBusy] = useState(false);

  function resetPreview() {
    setPreview(null);
  }

  async function handleFile(file, type) {
    if (!file) return;
    const text = await file.text();
    const { rows } = parseCSVText(text);
    if (!rows.length) {
      setLog((p) => p + "No rows found in CSV.\n");
      return;
    }
    const headers = rows[0].map((h) => h.toLowerCase());
    const body = rows.slice(1);
    setPreview({ type, headers, rows: body.slice(0, 500) }); // safety cap shown rows
    setLog((p) => p + `Parsed ${body.length} rows for ${type} (showing first ${Math.min(body.length, 500)}).\n`);
  }

  async function importNow() {
    if (!preview) return;
    setBusy(true);
    try {
      const { type, headers, rows } = preview;

      const idx = (name) => headers.indexOf(name);
      let imported = 0;

      if (type === "products") {
        // Expect headers: name, price
        const iName = idx("name");
        const iPrice = idx("price");
        if (iName === -1) throw new Error(`"name" header not found`);
        if (iPrice === -1) throw new Error(`"price" header not found`);

        for (const r of rows) {
          const name = r[iName] || "";
          const price = Number(r[iPrice] || 0);
          if (!name) continue;
          await createProduct({ name, price });
          imported++;
        }

        setLog((p) => p + `Imported ${imported} products successfully.\n`);
        resetPreview();
        setBusy(false);
        return;
      }

      if (type === "customers") {
        // Expect headers: name, phone, address, grabwin, grabcar, nationality
        const iName = idx("name");
        if (iName === -1) throw new Error(`"name" header not found`);
        const iPhone = idx("phone");
        const iAddress = idx("address");
        const iGrabwin = idx("grabwin");
        const iGrabcar = idx("grabcar");
        const iNationality = idx("nationality");

        for (const r of rows) {
          const draft = {
            name: r[iName] || "",
            phone: iPhone >= 0 ? r[iPhone] || "" : "",
            address: iAddress >= 0 ? r[iAddress] || "" : "",
            grabwin: iGrabwin >= 0 ? r[iGrabwin] || "" : "",
            grabcar: iGrabcar >= 0 ? r[iGrabcar] || "" : "",
            nationality: iNationality >= 0 ? r[iNationality] || "" : "",
          };
          if (!draft.name) continue;
          await createCustomer(draft);
          imported++;
        }

        setLog((p) => p + `Imported ${imported} customers successfully.\n`);
        resetPreview();
        setBusy(false);
        return;
      }

      if (type === "orders") {
        // Expect headers: date, customerName, customerPhone, customerAddress, productName, qty, price, deliveryFee, notes
        const iDate = idx("date");
        const iCName = idx("customername");
        const iCPhone = idx("customerphone");
        const iCAddr = idx("customeraddress");
        const iPName = idx("productname");
        const iQty = idx("qty");
        const iPrice = idx("price");
        const iFee = idx("deliveryfee");
        const iNotes = idx("notes");

        const missing = [];
        if (iDate === -1) missing.push("date");
        if (iCName === -1) missing.push("customerName");
        if (iPName === -1) missing.push("productName");
        if (iQty === -1) missing.push("qty");
        if (iPrice === -1) missing.push("price");
        if (missing.length) {
          throw new Error(`Missing required headers: ${missing.join(", ")}`);
        }

        const payload = rows.map((r) => ({
          date: (r[iDate] || "").slice(0, 10),
          customerName: (r[iCName] || "").trim(),
          customerPhone: iCPhone >= 0 ? r[iCPhone] || "" : "",
          customerAddress: iCAddr >= 0 ? r[iCAddr] || "" : "",
          productName: (r[iPName] || "").trim(),
          qty: Number(r[iQty] || 0),
          price: Number(r[iPrice] || 0), // unit price
          deliveryFee:
            iFee >= 0
              ? (r[iFee] === "" || r[iFee] == null ? null : Number(r[iFee]))
              : null,
          notes: iNotes >= 0 ? r[iNotes] || "" : "",
        }));

        const resp = await fetch("/.netlify/functions/import-orders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || "Import failed");

        setLog((p) => p + `Orders import: created ${data.created}, merged ${data.merged}, items ${data.itemsInserted}, groups ${data.ordersProcessed}.\n`);
        resetPreview();
        setBusy(false);
        return;
      }

      // Unknown type fallback
      throw new Error(`Unsupported import type: ${type}`);
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
      <Section title="Import Products (CSV)">
        <p className="mb-2 text-sm text-gray-600">
          CSV headers required: <b>name,price</b>. If a value contains commas, wrap it in double-quotes, e.g.
          <code className="bg-gray-100 px-1 mx-1">"Sauce, extra spicy"</code>.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => handleFile(e.target.files?.[0], "products")}
          />
          <Button
            onClick={() => {
              const blob = new Blob([`name,price\nNasi Lemak,60\nRendang,120\n"Sauce, extra",10`], {
                type: "text/csv",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "sample_products.csv";
              a.click();
            }}
          >
            Download Products CSV
          </Button>
        </div>
      </Section>

      {/* CUSTOMERS */}
      <Section title="Import Customers (CSV)">
        <p className="mb-2 text-sm text-gray-600">
          CSV headers required: <b>name,phone,address,grabwin,grabcar,nationality</b>. Addresses with commas must be quoted,
          e.g. <code className="bg-gray-100 px-1 mx-1">"Zuellig House, Silom"</code>.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => handleFile(e.target.files?.[0], "customers")}
          />
          <Button
            onClick={() => {
              const blob = new Blob(
                [
                  `name,phone,address,grabwin,grabcar,nationality\n` +
                    `John Doe,0812345678,"Zuellig House, Silom",Yes,,TH\n` +
                    `Jane Smith,0898765432,"Sathorn Soi 1, Unit C6.2",,Yes,MY`,
                ],
                { type: "text/csv" }
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "sample_customers.csv";
              a.click();
            }}
          >
            Download Customers CSV
          </Button>
        </div>
      </Section>

      {/* ORDERS */}
      <Section title="Import Orders (CSV)">
        <div className="mb-2 text-sm text-gray-600 space-y-2">
          <p>
            CSV headers required:&nbsp;
            <b>date,customerName,customerPhone,customerAddress,productName,qty,price,deliveryFee,notes</b>
          </p>
          <ul className="list-disc ml-5">
            <li><b>date</b> must be <code>YYYY-MM-DD</code></li>
            <li>Each row is a <b>line item</b>; rows with same <b>date + customerName</b> are merged into one order</li>
            <li><b>price</b> is the <b>unit price</b> (not total)</li>
            <li><b>deliveryFee</b> can be repeated per row; it’s used once per order</li>
            <li><b>customerName</b> and <b>productName</b> should match existing entries (if not, they will be created)</li>
          </ul>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => handleFile(e.target.files?.[0], "orders")}
          />
          <Button
            onClick={() => {
              const sample =
                "date,customerName,customerPhone,customerAddress,productName,qty,price,deliveryFee,notes\n" +
                '2025-03-17,Jane Doe,0812345678,"Le Nice Ekammai 63",Nasi Lemak,2,80,50,Walk-in\n' +
                "2025-03-17,Jane Doe,0812345678,Le Nice Ekammai 63,Apam Balik,1,45,50,\n" +
                "2025-03-17,Alex Tan,0891112222,Baan Sathorn,Kuih Bingka Ubi,3,35,0,VIP Guest\n";
              const blob = new Blob([sample], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "sample_orders.csv";
              a.click();
            }}
          >
            Download Orders CSV
          </Button>
        </div>
      </Section>

      {/* PREVIEW */}
      {preview && (
        <Section
          title={`Preview: ${preview.type} (first ${Math.min(preview.rows.length, 500)} rows)`}
          right={
            <div className="flex gap-2">
              <Button onClick={resetPreview}>Clear</Button>
              <Button className="bg-green-100" onClick={importNow} disabled={busy}>
                {busy ? "Importing..." : "Import Now"}
              </Button>
            </div>
          }
        >
          <div className="overflow-auto border rounded-xl">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  {preview.headers.map((h, i) => (
                    <th key={i} className="p-2 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="border-b">
                    {preview.headers.map((_, j) => (
                      <td key={j} className="p-2">{r[j] ?? ""}</td>
                    ))}
                  </tr>
                ))}
                {preview.rows.length === 0 && (
                  <tr><td className="p-2 text-gray-500">No rows</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* LOGS */}
      <Section title="Logs">
        <pre className="bg-gray-100 p-3 rounded-xl text-sm whitespace-pre-wrap">
          {log || "No imports yet."}
        </pre>
      </Section>
    </div>
  );
}
