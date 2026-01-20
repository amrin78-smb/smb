// netlify/functions/invoice-xlsx.js
// Generates an XLSX invoice from an Excel template with defined names.
//
// Request body:
// {
//   order: { id, date, items: [{ name, qty, price }], deliveryFee, notes, ... },
//   customer: { name, phone, address, ... } | null
// }
//
// Template: templates/Invoice_Template.xlsx

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
  // In defined names model, localSheetId maps to worksheet index (0-based).
  // ExcelJS worksheets are 1-based for getWorksheet(<id>), but we resolve by order.
  const idx = Number(localSheetId);
  if (!Number.isFinite(idx)) return null;
  const ws = workbook.worksheets[idx];
  return ws?.name || null;
}

function getFirstRangeAnyScope(workbook, name) {
  // 1) Try workbook-scoped names
  const ranges = workbook.definedNames.getRanges(name);
  if (ranges && ranges.length) return ranges[0];

  // 2) Try worksheet-scoped names from the model
  const model = workbook.definedNames?.model;
  const defs = model?.definedName;
  if (!defs) return null;

  const hit = defs.find((d) => d?.name === name);
  if (!hit) return null;

  // hit.ref can be string or array of strings
  const ref = Array.isArray(hit.ref) ? hit.ref[0] : hit.ref;
  if (!ref) return null;

  // If worksheet-scoped, infer sheet name from localSheetId
  const sheet = hit.localSheetId !== undefined ? sheetNameByLocalId(workbook, hit.localSheetId) : null;

  // If ref already includes a sheet (e.g. "'Invoice Template'!$A$1"), keep it
  if (String(ref).includes("!")) return String(ref);

  // Otherwise attach inferred sheet
  if (!sheet) return null;

  // Quote sheet name if it contains spaces
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

    // Infer sheet from InvoiceNo (falls back to first sheet)
    const invoiceNoRange = getFirstRangeAnyScope(wb, "InvoiceNo");
    const parsedSheet = invoiceNoRange ? parseRange(invoiceNoRange) : null;
    const ws = parsedSheet ? wb.getWorksheet(parsedSheet.sheet) : wb.worksheets[0];
    if (!ws) return json(500, { ok: false, error: "Worksheet not found in template" });

    const setNamed = (name, value) => {
      const r = getFirstRangeAnyScope(wb, name);
      if (!r) return false;
      const p = parseRange(r);
      if (!p) return false;
      const w = wb.getWorksheet(p.sheet);
      if (!w) return false;

      // Ignore row ranges like "$16:$16"
      if (p.addr.includes(":") && !p.addr.match(/\$[A-Z]+\$\d+/)) return false;

      const cell = w.getCell(stripDollar(p.addr));
      // If template has a formula, keep it (do not overwrite)
      if (cell.value && typeof cell.value === "object" && cell.value.formula) return true;

      cell.value = value;
      return true;
    };

    // Header
    setNamed("InvoiceNo", `INV-${order.id}`);
    setNamed("InvoiceDate", new Date(`${order.date}T00:00:00`));

    if (customer?.name) setNamed("CustomerName", customer.name);
    if (customer?.address) setNamed("CustomerAddress", customer.address);
    if (customer?.phone) setNamed("CustomerPhone", customer.phone);

    if (order?.notes) setNamed("Notes", order.notes);

    const deliveryFee = Number(order.deliveryFee || 0);
    setNamed("DeliveryFee", deliveryFee);

    // Resolve item base row/cols from defined names (workbook or worksheet scope)
    const itemDescRange = getFirstRangeAnyScope(wb, "ItemDesc");
    const itemQtyRange = getFirstRangeAnyScope(wb, "ItemQty");
    const itemUnitRange = getFirstRangeAnyScope(wb, "ItemUnitPrice");
    const itemLineRange = getFirstRangeAnyScope(wb, "ItemLineTotal");

    if (!itemDescRange || !itemQtyRange || !itemUnitRange || !itemLineRange) {
      return json(400, {
        ok: false,
        error: "Template missing item defined names (ItemDesc/ItemQty/ItemUnitPrice/ItemLineTotal). Check Name Manager scope = Workbook or re-save template.",
      });
    }

    const pd = parseRange(itemDescRange);
    const pq = parseRange(itemQtyRange);
    const pu = parseRange(itemUnitRange);
    const pl = parseRange(itemLineRange);

    const w = wb.getWorksheet(pd.sheet);
    if (!w) return json(500, { ok: false, error: "Item worksheet not found" });

    const descAddr = stripDollar(pd.addr);
    const qtyAddr = stripDollar(pq.addr);
    const unitAddr = stripDollar(pu.addr);
    const lineAddr = stripDollar(pl.addr);

    const baseRow = extractRowNumber(descAddr);
    if (!baseRow) return json(500, { ok: false, error: "Failed to resolve ItemDesc base row" });

    const descCol = w.getCell(descAddr).col;
    const qtyCol = w.getCell(qtyAddr).col;
    const unitCol = w.getCell(unitAddr).col;
    const lineCol = w.getCell(lineAddr).col;

    const items = order.items.map((it) => ({
      desc: it.name || it.productName || it.product || it.desc || "",
      qty: Number(it.qty ?? it.quantity ?? 0),
      unit: Number(it.price ?? it.unitPrice ?? 0),
    }));

    // Duplicate base row for extra items (preserves formulas/format)
    const extra = Math.max(0, items.length - 1);
    for (let i = 0; i < extra; i++) {
      w.duplicateRow(baseRow, 1, true);
    }

    // Fill values
    items.forEach((it, idx) => {
      const r = baseRow + idx;
      w.getCell(r, descCol).value = it.desc;
      w.getCell(r, qtyCol).value = it.qty;
      w.getCell(r, unitCol).value = it.unit;

      const lineCell = w.getCell(r, lineCol);
      if (!lineCell.value) lineCell.value = it.qty * it.unit;
    });

    // Safety fallback: if totals are NOT formula cells, populate them
    const subTotal = items.reduce((s, it) => s + it.qty * it.unit, 0);
    setNamed("SubTotal", subTotal);
    setNamed("GrandTotal", subTotal + deliveryFee);

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
