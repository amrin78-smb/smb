// netlify/functions/invoice-xlsx.js
// Generates an XLSX invoice from an Excel template.
//
// Fixes in this version:
// 1) Prevent Excel "repair" warnings by NOT duplicating/inserting rows (duplicateRow can corrupt templates with merges).
//    Instead it fills existing item lines starting at row 16.
// 2) Customer Name and Address are written to separate cells (A8 and A9 fallback).
// 3) Robust date parsing: supports YYYY-MM-DD and DD-MM-YYYY; otherwise writes raw string.
//
// Template: templates/Invoice_Template.xlsx
//
// Request body:
// { order: { id, date, items: [{name,qty,price}, ...], deliveryFee, notes }, customer: { name, address, phone } }

import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

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
  const ws = workbook.worksheets[idx];
  return ws?.name || null;
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

  const sheet = hit.localSheetId !== undefined ? sheetNameByLocalId(workbook, hit.localSheetId) : null;
  if (!sheet) return null;

  const sheetPart = sheet.includes(" ") ? `'${sheet}'` : sheet;
  return `${sheetPart}!${ref}`;
}

function trySetNamed(wb, name, value) {
  const r = getFirstRangeAnyScope(wb, name);
  if (!r) return false;
  const p = parseRange(r);
  if (!p) return false;
  const w = wb.getWorksheet(p.sheet);
  if (!w) return false;

  if (p.addr.includes(":") && !p.addr.match(/\$[A-Z]+\$\d+/)) return false;

  const cell = w.getCell(stripDollar(p.addr));
  if (cell.value && typeof cell.value === "object" && cell.value.formula) return true;
  cell.value = value;
  return true;
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

async function loadTemplateWorkbook() {
  const templatePath = path.resolve(process.cwd(), "templates", "Invoice_Template.xlsx");
  const fileBuf = await fs.readFile(templatePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileBuf);
  return { wb, templatePath, size: fileBuf.length };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // GET = diagnostics (optional)
  if (event.httpMethod === "GET") {
    try {
      const { wb, templatePath, size } = await loadTemplateWorkbook();
      let names = [];
      try { names = wb.definedNames.getNames(); } catch {}
      const required = ["CustomerName","CustomerAddress","CustomerPhone","InvoiceNo","InvoiceDate","ItemDesc","ItemQty","ItemUnitPrice","ItemLineTotal","SubTotal","DeliveryFee","GrandTotal"];
      const resolved = {};
      for (const r of required) resolved[r] = getFirstRangeAnyScope(wb, r);
      return json(200, { ok: true, templatePath, templateBytes: size, worksheetNames: wb.worksheets.map(w=>w.name), definedNamesKeys: names, requiredResolved: resolved });
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
  const customer = payload.customer || null;

  if (!order || !order.id || !order.date || !Array.isArray(order.items)) {
    return json(400, { ok: false, error: "Missing or invalid order payload" });
  }

  try {
    const { wb } = await loadTemplateWorkbook();
    const ws = wb.getWorksheet("Invoice Template") || wb.getWorksheet("Invoice_Template") || wb.worksheets[0];
    if (!ws) return json(500, { ok: false, error: "Worksheet not found in template" });

    // Invoice No
    const invoiceNo = `INV-${order.id}`;
    if (!trySetNamed(wb, "InvoiceNo", invoiceNo)) ws.getCell("H7").value = invoiceNo;

    // Date
    const d = parseOrderDate(order.date);
    if (d) {
      if (!trySetNamed(wb, "InvoiceDate", d)) ws.getCell("H8").value = d;
    } else {
      if (!trySetNamed(wb, "InvoiceDate", String(order.date))) ws.getCell("H8").value = String(order.date);
    }

    // Customer (separate cells)
    const custName = String(customer?.name || "");
    const custAddr = String(customer?.address || "");
    const custPhone = String(customer?.phone || "");

    if (!trySetNamed(wb, "CustomerName", custName)) ws.getCell("A8").value = custName;
    if (!trySetNamed(wb, "CustomerAddress", custAddr)) ws.getCell("A9").value = custAddr;
    if (custPhone) {
      if (!trySetNamed(wb, "CustomerPhone", custPhone)) ws.getCell("A11").value = custPhone;
    }

    if (order?.notes) trySetNamed(wb, "Notes", order.notes);

    // Delivery fee
    const deliveryFee = Number(order.deliveryFee || 0);
    if (!trySetNamed(wb, "DeliveryFee", deliveryFee)) ws.getCell("H32").value = deliveryFee;

    // Item coordinates (prefer names)
    const itemDescRange = getFirstRangeAnyScope(wb, "ItemDesc");
    const itemQtyRange = getFirstRangeAnyScope(wb, "ItemQty");
    const itemUnitRange = getFirstRangeAnyScope(wb, "ItemUnitPrice");
    const itemLineRange = getFirstRangeAnyScope(wb, "ItemLineTotal");

    let baseRow = 16;
    let descCol = ws.getCell("A16").col;
    let qtyCol = ws.getCell("F16").col;
    let unitCol = ws.getCell("G16").col;
    let lineCol = ws.getCell("H16").col;

    if (itemDescRange && itemQtyRange && itemUnitRange && itemLineRange) {
      const pd = parseRange(itemDescRange);
      const pq = parseRange(itemQtyRange);
      const pu = parseRange(itemUnitRange);
      const pl = parseRange(itemLineRange);

      const w = wb.getWorksheet(pd?.sheet) || ws;

      const descAddr = stripDollar(pd?.addr);
      const qtyAddr = stripDollar(pq?.addr);
      const unitAddr = stripDollar(pu?.addr);
      const lineAddr = stripDollar(pl?.addr);

      const rowMatch = String(descAddr).match(/\d+$/);
      if (rowMatch) baseRow = parseInt(rowMatch[0], 10);

      descCol = w.getCell(descAddr).col;
      qtyCol = w.getCell(qtyAddr).col;
      unitCol = w.getCell(unitAddr).col;
      lineCol = w.getCell(lineAddr).col;
    }

    const items = order.items.map((it) => ({
      desc: it.name || it.productName || it.product || it.desc || "",
      qty: Number(it.qty ?? it.quantity ?? 0),
      unit: Number(it.price ?? it.unitPrice ?? 0),
    }));

    const maxRows = 30;
    const maxWrite = Math.min(items.length, maxRows - baseRow + 1);

    for (let i = 0; i < maxWrite; i++) {
      const r = baseRow + i;
      ws.getCell(r, descCol).value = items[i].desc;
      ws.getCell(r, qtyCol).value = items[i].qty;
      ws.getCell(r, unitCol).value = items[i].unit;

      const lineCell = ws.getCell(r, lineCol);
      if (!(lineCell.value && typeof lineCell.value === "object" && lineCell.value.formula)) {
        lineCell.value = items[i].qty * items[i].unit;
      }
    }

    const subTotal = items.reduce((s, it) => s + it.qty * it.unit, 0);
    if (!trySetNamed(wb, "SubTotal", subTotal) && !trySetNamed(wb, "Subtotal", subTotal)) ws.getCell("H31").value = subTotal;
    if (!trySetNamed(wb, "GrandTotal", subTotal + deliveryFee)) ws.getCell("H34").value = subTotal + deliveryFee;

    const outBuf = await wb.xlsx.writeBuffer();
    const filename = `Invoice_${String(order.date).replaceAll("-", "")}_${order.id}.xlsx`;

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
