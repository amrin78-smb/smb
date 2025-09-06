import React, { useState } from "react";
import { createProduct, createCustomer } from "../api";

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

export default function Settings() {
  const [log, setLog] = useState("");

  async function parseCSV(file, type) {
    const text = await file.text();
    const rows = text.split(/\r?\n/).map((r) => r.split(",").map((c) => c.trim()));
    rows.shift(); // remove header
    let imported = 0;

    for (const row of rows) {
      if (row.length === 0 || !row[0]) continue;

      if (type === "products") {
        const [name, price] = row;
        if (name) {
          await createProduct({ name, price: Number(price || 0) });
          imported++;
        }
      } else if (type === "customers") {
        const [name, phone, address, grabwin, grabcar, nationality] = row;
        if (name) {
          await createCustomer({ name, phone, address, grabwin, grabcar, nationality });
          imported++;
        }
      }
    }
    setLog((prev) => prev + `Imported ${imported} ${type}\n`);
  }

  return (
    <div className="max-w-6xl mx-auto mt-6">
      <Section title="Import Products (CSV)">
        <p className="mb-2 text-sm text-gray-600">
          Upload a CSV with headers: <b>name,price</b>
        </p>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => e.target.files[0] && parseCSV(e.target.files[0], "products")}
        />
      </Section>

      <Section title="Import Customers (CSV)">
        <p className="mb-2 text-sm text-gray-600">
          Upload a CSV with headers: <b>name,phone,address,grabwin,grabcar,nationality</b>
        </p>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => e.target.files[0] && parseCSV(e.target.files[0], "customers")}
        />
      </Section>

      <Section title="Sample CSV Downloads">
        <div className="flex gap-4">
          <Button
            onClick={() => {
              const blob = new Blob([`name,price\nNasi Lemak,60\nRendang,120`], {
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
          <Button
            onClick={() => {
              const blob = new Blob(
                [
                  `name,phone,address,grabwin,grabcar,nationality\nJohn Doe,0812345678,Bangkok,Yes,,TH\nJane Smith,0898765432,Chiang Mai,,Yes,MY`,
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

      <Section title="Logs">
        <pre className="bg-gray-100 p-3 rounded-xl text-sm whitespace-pre-wrap">
          {log || "No imports yet."}
        </pre>
      </Section>
    </div>
  );
}
