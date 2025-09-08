import { useMemo } from "react";

export const todayStr = () => new Date().toISOString().slice(0, 10);

export const formatTHB = (n) =>
  new Intl.NumberFormat("en-TH", { style: "currency", currency: "THB" }).format(Number(n || 0));

export function useFuzzy(items, keys, query) {
  return useMemo(() => {
    const q = (query || "").toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      keys.some((k) => String(it[k] || "").toLowerCase().includes(q))
    );
  }, [items, keys, query]);
}

export async function getBase64FromUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// utils/format.js
export function formatDateDMY(value) {
  if (!value) return "";
  const s = String(value).trim();

  // If value looks like "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss..."
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  // Fallback: try Date parsing (covers Date objects / other formats)
  const d = value instanceof Date ? value : new Date(s);
  if (isNaN(d)) return s; // leave as-is if unparsable
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// Show "MM-YYYY" for strings like "2025-08"
export function formatMonthMY(value) {
  if (!value) return "";
  const m = String(value).match(/^(\d{4})-(\d{2})$/); // YYYY-MM
  if (m) return `${m[2]}-${m[1]}`;
  return value;
}


