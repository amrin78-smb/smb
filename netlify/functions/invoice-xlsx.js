// netlify/functions/invoice-xlsx.js
// XLSX invoice generator (named-cells required for customer fields).
//
// This version adds a DEBUG GET endpoint so you can verify what Netlify is actually reading.
// - GET  /.netlify/functions/invoice-xlsx  -> returns template size, SHA256, and defined names detected by ExcelJS
// - POST /.netlify/functions/invoice-xlsx  -> generates invoice as before
//
// Required defined names:
// InvoiceNo, InvoiceDate, CustomerName, CustomerAddress, CustomerPhone
// (others can remain formula-driven in the template)

import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import crypto from "node:crypto";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-smb-user",
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { ...corsHeaders, "content-type": "application/json" },
    body: JSON.stringify(obj, null, 2),
  };
}

function parseRange(rangeStr) {
  const m = String(rangeStr).match(/^(?:'([^']+)'|([^!]+))!(.+)$/);
  if (!m) return null;
  return { sheet: m[1] || m[2], addr: m[3] };
}

const stripDollar = (s) => String(s).replaceAll("$", "");

function sheetNameByLocalId(workbook, localSheetId) {
  const idx = Number(localSheetId);
  if (!Number.isFinite(idx)) return null;
  return workbook.worksheets[idx]?.name || null;
}

function getFirstRangeAnyScope(workbook, name) {
  try {
    const ranges = workbook.definedNames.getRanges(name);
    if (ranges && ranges.length) return ranges[0];
  } catch {}

  const model = workbook.definedNames?.model;
  const defs = model?.definedName;
  if (!defs) return null;

  const hit = defs.find((d) => d?.name === name);
  if (!hit) return null;

  const ref = Array.isArray(hit.ref) ? hit.ref[0] : hit.ref;
  if (!ref) return null;

  if (String(ref).includes("!")) return String(ref);

  const sheet = hit.localSheetId !== undefined
    ? sheetNameByLocalId(workbook, hit.localSheetId)
    : null;

  if (!sheet) return null;

  const sheetPart = sheet.includes(" ") ? `'${sheet}'` : sheet;
  return `${sheetPart}!${ref}`;
}

function setNamedRequired(wb, name, value) {
  const r = getFirstRangeAnyScope(wb, name);
  if (!r) throw new Error(`Required named cell not found: ${name}`);
  const p = parseRange(r);
  const w = wb.getWorksheet(p.sheet);
  const cell = w.getCell(stripDollar(p.addr));
  if (cell.value && typeof cell.value === "object" && cell.value.formula) return;
  cell.value = value;
}

function parseOrderDate(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);

  m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;

  return null;
}

async function loadTemplate() {
  const templatePath = path.resolve(process.cwd(), "templates", "Invoice_Template.xlsx");
  const buf = await fs.readFile(templatePath);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { wb, templatePath, size: buf.length, sha256 };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod === "GET") {
    try {
      const { wb, templatePath, size, sha256 } = await loadTemplate();
      let names = [];
      try { names = wb.definedNames.getNames(); } catch {}
      const required = ["InvoiceNo","InvoiceDate","CustomerName","CustomerAddress","CustomerPhone","ItemDesc","ItemQty","ItemUnitPrice","ItemLineTotal","SubTotal","DeliveryFee","GrandTotal"];
      const resolved = {};
      for (const r of required) resolved[r] = getFirstRangeAnyScope(wb, r);

      return json(200, {
        ok: true,
        templatePath,
        templateBytes: size,
        templateSha256: sha256,
        worksheetNames: wb.worksheets.map((w) => w.name),
        definedNamesKeys: names,
        requiredResolved: resolved,
      });
    } catch (e) {
      return json(500, { ok: false, error: e?.message || String(e) });
    }
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const order = payload.order;
  const customer = payload.customer || {};

  if (!order || !order.id || !order.date || !Array.isArray(order.items)) {
    return json(400, { ok: false, error: "Invalid order payload" });
  }

  try {
    const { wb } = await loadTemplate();

    // Header
    setNamedRequired(wb, "InvoiceNo", `INV-${order.id}`);
    const d = parseOrderDate(order.date);
    if (!d) throw new Error("Unable to parse order date");
    setNamedRequired(wb, "InvoiceDate", d);

    // Customer fields (named cells only)
    setNamedRequired(wb, "CustomerName", String(customer.name || ""));
    setNamedRequired(wb, "CustomerAddress", String(customer.address || ""));
    setNamedRequired(wb, "CustomerPhone", String(customer.phone || ""));

    // Items (fixed lines – template should have enough rows)
    const ws =
      wb.getWorksheet("Invoice Template") ||
      wb.getWorksheet("Invoice_Template") ||
      wb.worksheets[0];

    const baseRow = 16;
    const descCol = ws.getCell("A16").col;
    const qtyCol = ws.getCell("F16").col;
    const unitCol = ws.getCell("G16").col;
    const lineCol = ws.getCell("H16").col;

    const items = order.items.map((it) => ({
      desc: it.name || it.productName || it.product || "",
      qty: Number(it.qty ?? it.quantity ?? 0),
      unit: Number(it.price ?? it.unitPrice ?? 0),
    }));

    for (let i = 0; i < items.length; i++) {
      const r = baseRow + i;
      ws.getCell(r, descCol).value = items[i].desc;
      ws.getCell(r, qtyCol).value = items[i].qty;
      ws.getCell(r, unitCol).value = items[i].unit;

      const lc = ws.getCell(r, lineCol);
      if (!(lc.value && typeof lc.value === "object" && lc.value.formula)) {
        lc.value = items[i].qty * items[i].unit;
      }
    }

    // Filename
    const safeName = String(customer.name || "Customer")
      .replace(/[^\w\d]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const dateStr = d.toISOString().slice(0, 10).replaceAll("-", "");
    const filename = `SMB_${safeName}_${dateStr}.xlsx`;

    const outBuf = await wb.xlsx.writeBuffer();

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`,
      },
      isBase64Encoded: true,
      body: Buffer.from(outBuf).toString("base64"),
    };
  } catch (e) {
    return json(500, { ok: false, error: e?.message || String(e) });
  }
};
