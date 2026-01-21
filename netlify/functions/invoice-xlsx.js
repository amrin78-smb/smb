// netlify/functions/invoice-xlsx.js
// XLSX invoice generator (hardcoded customer cells per request).
//
// Customer placement:
// - Name    -> A9
// - Address -> A10
// - Phone   -> A11
//
// Filename:
//   SMB_<CustomerName>_<YYYYMMDD>.xlsx
//
// Notes:
// - No row insertion/duplication (Excel-safe).
// - Invoice number/date: writes to H7/H8 (and will also set named cells if they exist).
//
// Request body:
// { order: { id, date, items: [{name,qty,price}, ...], deliveryFee, notes }, customer: { name, address, phone } }

import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-smb-user",
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { ...corsHeaders, "content-type": "application/json" },
    body: JSON.stringify(obj),
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

  const sheet = hit.localSheetId !== undefined ? sheetNameByLocalId(workbook, hit.localSheetId) : null;
  if (!sheet) return null;

  const sheetPart = sheet.includes(" ") ? `'${sheet}'` : sheet;
  return `${sheetPart}!${ref}`;
}

function setNamedIfExists(wb, name, value) {
  const r = getFirstRangeAnyScope(wb, name);
  if (!r) return false;
  const p = parseRange(r);
  const w = wb.getWorksheet(p.sheet);
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

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
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
    const templatePath = path.resolve(process.cwd(), "templates", "Invoice_Template.xlsx");
    const fileBuf = await fs.readFile(templatePath);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fileBuf);

    const ws =
      wb.getWorksheet("Invoice Template") ||
      wb.getWorksheet("Invoice_Template") ||
      wb.worksheets[0];

    if (!ws) throw new Error("Worksheet not found");

    const d = parseOrderDate(order.date);
    if (!d) throw new Error("Unable to parse order date");

    // Hardcoded customer placement (per your request)
    const custName = String(customer.name || "");
    const custAddr = String(customer.address || "");
    const custPhone = String(customer.phone || "");

    ws.getCell("A9").value = custName;
    ws.getCell("A10").value = custAddr;
    ws.getCell("A11").value = custPhone;

    // Also set named cells if they happen to exist (harmless)
    setNamedIfExists(wb, "CustomerName", custName);
    setNamedIfExists(wb, "CustomerAddress", custAddr);
    setNamedIfExists(wb, "CustomerPhone", custPhone);

    // Invoice no/date (fallback to H7/H8)
    const invoiceNo = `INV-${order.id}`;
    if (!setNamedIfExists(wb, "InvoiceNo", invoiceNo)) ws.getCell("H7").value = invoiceNo;
    if (!setNamedIfExists(wb, "InvoiceDate", d)) ws.getCell("H8").value = d;

    // Items (fixed rows)
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

    // Delivery fee (template expects H32 / named range "DeliveryFee")
    // Accept both deliveryFee (camelCase) and delivery_fee (snake_case) from payload.
    const deliveryFeeRaw =
      order.deliveryFee ?? order.delivery_fee ?? order.delivery ?? 0;
    const deliveryFee = Number(deliveryFeeRaw);
    const deliveryFeeValue = Number.isFinite(deliveryFee) ? deliveryFee : 0;

    // Prefer named range when present; also set H32 as a safe fallback.
    setNamedIfExists(wb, "DeliveryFee", deliveryFeeValue);
    ws.getCell("H32").value = deliveryFeeValue;


    // Filename: SMB_<CustomerName>_<YYYYMMDD>.xlsx
    const safeName = custName
      ? custName.replace(/[^\w\d]+/g, "_").replace(/^_+|_+$/g, "")
      : "Customer";
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
    return json(500, { ok: false, error: e.message || String(e) });
  }
};
