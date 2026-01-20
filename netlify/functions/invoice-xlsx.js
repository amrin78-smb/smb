// netlify/functions/invoice-xlsx.js
// Generates an XLSX invoice from an Excel template with defined names.
// DEBUG mode: GET returns the defined names detected in the deployed template.

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
  const ranges = workbook.definedNames.getRanges(name);
  if (ranges && ranges.length) return ranges[0];

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

  // DEBUG endpoint: GET returns what the function actually sees in production
  if (event.httpMethod === "GET") {
    try {
      const { wb, templatePath, size } = await loadTemplateWorkbook();

      // Collect names via workbook.definedNames
      const names = [];
      try {
        const keys = wb.definedNames.getNames();
        for (const n of keys) {
          const r = wb.definedNames.getRanges(n) || [];
          names.push({ name: n, ranges: r });
        }
      } catch (e) {
        // best effort
      }

      // Also collect underlying model-defined names (worksheet-scoped)
      const modelDefs = (wb.definedNames?.model?.definedName || []).map((d) => ({
        name: d?.name,
        ref: d?.ref,
        localSheetId: d?.localSheetId,
        sheet: d?.localSheetId !== undefined ? sheetNameByLocalId(wb, d.localSheetId) : null,
      }));

      const required = ["ItemDesc", "ItemQty", "ItemUnitPrice", "ItemLineTotal", "ItemRow", "InvoiceNo", "InvoiceDate", "SubTotal", "DeliveryFee", "GrandTotal"];
      const resolved = {};
      for (const r of required) {
        resolved[r] = getFirstRangeAnyScope(wb, r);
      }

      return json(200, {
        ok: true,
        templatePath,
        templateBytes: size,
        worksheetNames: wb.worksheets.map((w) => w.name),
        requiredResolved: resolved,
        definedNamesKeys: names.map((x) => x.name).sort(),
        definedNamesWithRanges: names.filter((x) => required.includes(x.name)),
        modelDefinedNames: modelDefs.filter((x) => required.includes(x.name)),
      });
    } catch (e) {
      return json(500, { ok: false, error: e?.message || String(e) });
    }
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  // Normal POST path (same behavior as before): minimal implementation to keep focus on debugging
  // We keep the original error if names are missing to confirm resolution.
  try {
    const { wb } = await loadTemplateWorkbook();

    const itemDescRange = getFirstRangeAnyScope(wb, "ItemDesc");
    const itemQtyRange = getFirstRangeAnyScope(wb, "ItemQty");
    const itemUnitRange = getFirstRangeAnyScope(wb, "ItemUnitPrice");
    const itemLineRange = getFirstRangeAnyScope(wb, "ItemLineTotal");

    if (!itemDescRange || !itemQtyRange || !itemUnitRange || !itemLineRange) {
      return json(400, {
        ok: false,
        error: "Template missing item defined names (ItemDesc/ItemQty/ItemUnitPrice/ItemLineTotal). Check Name Manager scope = Workbook or re-save template.",
        debug: {
          ItemDesc: itemDescRange,
          ItemQty: itemQtyRange,
          ItemUnitPrice: itemUnitRange,
          ItemLineTotal: itemLineRange,
          definedNamesKeys: (() => { try { return wb.definedNames.getNames(); } catch { return []; } })(),
        },
      });
    }

    return json(200, { ok: true, message: "Template contains required item names." });
  } catch (e) {
    return json(500, { ok: false, error: e?.message || String(e) });
  }
};
