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

