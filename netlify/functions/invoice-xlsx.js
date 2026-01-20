// netlify/functions/invoice-xlsx.js
// Generates an XLSX invoice from an Excel template.
//
// It prefers defined names (Workbook or Worksheet scope). If some names are missing,
// it falls back to default cells on sheet "Invoice Template":
// - InvoiceNo: H7
// - InvoiceDate: H8
// - CustomerAddress (name+address): A8
// - CustomerPhone: A12
// - Item row: row 16, columns A (desc), F (qty), G (unit), H (line total)
// - Subtotal: H31
// - DeliveryFee: H32
// - GrandTotal: H34
//
// Request body:
// { order: { id, date, items, deliveryFee, notes }, customer: { name, address, phone } }

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
    body: JSON.stringify(obj),
  };
}

function parseRange(rangeStr) {
  const m = rangeStr.match(/^(?:'([^']+)'|([^!]+))!(.+)$/);
  if (!m) return null;
  return { sheet: m[1] || m[2], addr: m[3] };
}

const stripDollar = (s) => s.replaceAll("$", "");

function extractRowNumber(cellAddress) {
  const m = cellAddress.match(/\d+$/);
  return m ? parseInt(m[0], 10) : null;
}

function sheetNameByLocalId(workbook, localSheetId) {
  const idx = Number(localSheetId);
  if (!Number.isFinite(idx)) return null;
  const ws = workbook.worksheets[idx];
  return ws?.name || null;
}

function getFirstRangeAnyScope(workbook, name) {
  // 1) workbook-scoped
  const ranges = workbook.definedNames.getRanges(name);
  if (ranges && ranges.length) return ranges[0];

  // 2) worksheet-scoped (model)
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
  const customer = payload.customer || null;

  if (!order || !order.id || !order.date || !Array.isArray(order.items)) {
    return json(400, { ok: false, error: "Missing or invalid order payload" });
  }

  try {
    const templatePath = path.resolve(process.cwd(), "templates", "Invoice_Template.xlsx");
    const fileBuf = await fs.readFile(templatePath);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fileBuf);

    // Worksheet
    const ws =
      wb.getWorksheet("Invoice Template") ||
      wb.getWorksheet("Invoice_Template") ||
      wb.worksheets[0];

    if (!ws) return json(500, { ok: false, error: "Worksheet not found in template" });

    // Helper: set a named cell if it exists; returns true/false
    const trySetNamed = (name, value) => {
      const r = getFirstRangeAnyScope(wb, name);
      if (!r) return false;
      const p = parseRange(r);
      if (!p) return false;
      const w = wb.getWorksheet(p.sheet);
      if (!w) return false;

      // Ignore row ranges like "$16:$16"
      if (p.addr.includes(":") && !p.addr.match(/\$[A-Z]+\$\d+/)) return false;

      const cell = w.getCell(stripDollar(p.addr));
      if (cell.value && typeof cell.value === "object" && cell.value.formula) return true; // keep formulas
      cell.value = value;
      return true;
    };

    // Header (prefer names; fallback to fixed cells)
    const invoiceNo = `INV-${order.id}`;
    if (!trySetNamed("InvoiceNo", invoiceNo)) ws.getCell("H7").value = invoiceNo;

    const invDate = new Date(`${order.date}T00:00:00`);
    if (!trySetNamed("InvoiceDate", invDate)) ws.getCell("H8").value = invDate;

    const custName = customer?.name || "";
    const custAddr = customer?.address || "";
    const custPhone = customer?.phone || "";

    // If template has CustomerName / CustomerAddress separately, use them.
    // Otherwise write "Name\nAddress" into CustomerAddress (A8) and leave phone in A12.
    const hasNameCell = trySetNamed("CustomerName", custName);
    const hasAddrCell = trySetNamed("CustomerAddress", custAddr);

    if (!hasNameCell && !hasAddrCell) {
      const combined = [custName, custAddr].filter(Boolean).join("\n");
      if (!trySetNamed("CustomerAddress", combined)) ws.getCell("A8").value = combined;
    } else if (!hasNameCell && hasAddrCell && custName) {
      // Address exists but name cell missing: prepend name into address cell
      // (avoid overwriting formula cells handled above)
      const combined = [custName, custAddr].filter(Boolean).join("\n");
      trySetNamed("CustomerAddress", combined);
    }

    if (!trySetNamed("CustomerPhone", custPhone) && custPhone) ws.getCell("A12").value = custPhone;

    if (order?.notes) trySetNamed("Notes", order.notes);

    const deliveryFee = Number(order.deliveryFee || 0);
    if (!trySetNamed("DeliveryFee", deliveryFee)) ws.getCell("H32").value = deliveryFee;

    // Items: try named cells; otherwise fallback to A16/F16/G16/H16
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

      const w = wb.getWorksheet(pd.sheet) || ws;

      const descAddr = stripDollar(pd.addr);
      const qtyAddr = stripDollar(pq.addr);
      const unitAddr = stripDollar(pu.addr);
      const lineAddr = stripDollar(pl.addr);

      const resolvedRow = extractRowNumber(descAddr);
      if (resolvedRow) baseRow = resolvedRow;

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

    // Duplicate base row for extra items
    const extra = Math.max(0, items.length - 1);
    for (let i = 0; i < extra; i++) {
      ws.duplicateRow(baseRow, 1, true);
    }

    // Fill values
    items.forEach((it, idx) => {
      const r = baseRow + idx;
      ws.getCell(r, descCol).value = it.desc;
      ws.getCell(r, qtyCol).value = it.qty;
      ws.getCell(r, unitCol).value = it.unit;

      const lineCell = ws.getCell(r, lineCol);
      if (!lineCell.value) lineCell.value = it.qty * it.unit;
    });

    // Totals fallback (template formulas preferred)
    const subTotal = items.reduce((s, it) => s + it.qty * it.unit, 0);
    if (!trySetNamed("SubTotal", subTotal) && !trySetNamed("Subtotal", subTotal)) ws.getCell("H31").value = subTotal;
    if (!trySetNamed("GrandTotal", subTotal + deliveryFee)) ws.getCell("H34").value = subTotal + deliveryFee;

    const outBuf = await wb.xlsx.writeBuffer();
    const filename = `Invoice_${order.date.replaceAll("-", "")}_${order.id}.xlsx`;

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
