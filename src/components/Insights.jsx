import React, { useEffect, useMemo, useState } from "react";
import { getInsightsSummary, getCustomerInsights, listCustomers } from "../api";
import { formatTHB } from "../utils/format";

/* UI helpers */
const Section = ({ title, right, children }) => (
  <div className="w-full max-w-6xl mx-auto my-6 p-5 rounded-2xl shadow border bg-white">
    <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="flex items-center gap-2 flex-wrap">{right}</div>
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
const Select = (props) => (
  <select className="border rounded-xl px-3 py-2 text-sm" {...props} />
);

function ymToLabel(ym) {
  const [y, m] = (ym || "").split("-").map(Number);
  if (!y || !m) return ym;
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

/* Simple CSS bar-list "chart" (no deps) */
function BarList({ items, valueKey, labelKey, format = (v) => v }) {
  const max = Math.max(1, ...items.map((x) => Number(x[valueKey] || 0)));
  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        const v = Number(it[valueKey] || 0);
        const w = Math.round((v / max) * 100);
        return (
          <div key={i}>
            <div className="flex justify-between text-sm mb-1">
              <div className="truncate pr-2">{it[labelKey]}</div>
              <div className="tabular-nums">{format(v)}</div>
            </div>
            <div className="h-2 bg-gray-100 rounded-xl overflow-hidden">
              <div className="h-2 bg-gray-400" style={{ width: `${w}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function firstDayOfMonthISO(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset, 1);
  return d.toISOString().slice(0, 10);
}

export default function Insights() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthISO(0));
  const [dateTo, setDateTo] = useState(todayISO());
  const [summary, setSummary] = useState({
    monthly: [],
    topProducts: [],
    topCustomers: [],
  });
  const [loading, setLoading] = useState(false);

  const [customers, setCustomers] = useState([]);
  const [selCustomer, setSelCustomer] = useState("");
  const [custDetail, setCustDetail] = useState(null);

  async function loadSummary() {
    setLoading(true);
    try {
      const data = await getInsightsSummary({ dateFrom, dateTo });
      setSummary(data || { monthly: [], topProducts: [], topCustomers: [] });
    } finally {
      setLoading(false);
    }
  }

  async function loadCustomersList() {
    try {
      // Handle both shapes: array OR { items: [...] }
      const data = await listCustomers({ q: "", limit: 500 });
      const items = Array.isArray(data) ? data : data?.items ?? [];
      setCustomers(items);
    } catch (e) {
      console.error("Failed to load customers", e);
      setCustomers([]);
    }
  }

  async function loadCustomerDetail(id) {
    if (!id) {
      setCustDetail(null);
      return;
    }
    try {
      const data = await getCustomerInsights(Number(id), { dateFrom, dateTo });
      setCustDetail(data);
    } catch (e) {
      setCustDetail(null);
    }
  }

  useEffect(() => {
    loadSummary();
    loadCustomersList();
  }, []);

  const totalByMonth = useMemo(() => {
    return (summary.monthly || []).map((x) => ({
      label: ymToLabel(x.ym),
      total: Number(x.total || 0),
    }));
  }, [summary]);

  const totalRevenue = useMemo(() => {
    return (summary.monthly || []).reduce(
      (s, x) => s + Number(x.total || 0),
      0
    );
  }, [summary]);

  return (
    <div className="max-w-6xl mx-auto">
      <Section
        title="Insights & Reports"
        right={
          <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <input
              type="date"
              className="border rounded-xl px-3 py-2 text-sm w-full sm:w-auto"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <span className="hidden sm:inline">to</span>
            <input
              type="date"
              className="border rounded-xl px-3 py-2 text-sm w-full sm:w-auto"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
            <Button
              className="w-full sm:w-auto"
              onClick={loadSummary}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="p-4 rounded-xl border bg-gray-50">
            <div className="text-sm text-gray-600 mb-1">Total Revenue</div>
            <div className="text-2xl font-semibold">
              {formatTHB(totalRevenue)}
            </div>
          </div>
          <div className="p-4 rounded-xl border bg-gray-50">
            <div className="text-sm text-gray-600 mb-1">Top Customer</div>
            <div className="text-base">
              {summary.topCustomers?.[0]?.name || "—"}
            </div>
            <div className="text-sm text-gray-500">
              Spent {formatTHB(Number(summary.topCustomers?.[0]?.total || 0))}
            </div>
          </div>
          <div className="p-4 rounded-xl border bg-gray-50">
            <div className="text-sm text-gray-600 mb-1">
              Most Ordered Product
            </div>
            <div className="text-base">
              {summary.topProducts?.[0]?.product || "—"}
            </div>
            <div className="text-sm text-gray-500">
              {Number(summary.topProducts?.[0]?.qty || 0)} units
            </div>
          </div>
        </div>
      </Section>

      <Section title="Monthly Totals">
        {totalByMonth.length === 0 ? (
          <div className="text-sm text-gray-500">No data in this range.</div>
        ) : (
          <BarList
            items={totalByMonth}
            valueKey="total"
            labelKey="label"
            format={(v) => formatTHB(v)}
          />
        )}
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Section title="Top Products">
          {(summary.topProducts || []).length === 0 ? (
            <div className="text-sm text-gray-500">No data.</div>
          ) : (
            <BarList
              items={summary.topProducts.map((x) => ({
                label: x.product,
                value: Number(x.qty || 0),
              }))}
              valueKey="value"
              labelKey="label"
              format={(v) => `${v} pcs`}
            />
          )}
        </Section>

        <Section title="Top Customers">
          {(summary.topCustomers || []).length === 0 ? (
            <div className="text-sm text-gray-500">No data.</div>
          ) : (
            <BarList
              items={summary.topCustomers.map((x) => ({
                label: x.name,
                value: Number(x.total || 0),
              }))}
              valueKey="value"
              labelKey="label"
              format={(v) => formatTHB(v)}
            />
          )}
        </Section>
      </div>

      <Section
        title="Customer Details"
        right={
          <div className="w-full sm:w-auto">
            <Select
              value={selCustomer}
              onChange={(e) => {
                const v = e.target.value;
                setSelCustomer(v);
                loadCustomerDetail(v);
              }}
              className="w-full sm:w-auto"
            >
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        {!selCustomer ? (
          <div className="text-sm text-gray-500">
            Choose a customer to see their past orders and total spend.
          </div>
        ) : !custDetail ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border bg-gray-50">
                <div className="text-sm text-gray-600 mb-1">Customer</div>
                <div className="font-semibold">
                  {custDetail?.summary?.name || "—"}
                </div>
              </div>
              <div className="p-4 rounded-xl border bg-gray-50">
                <div className="text-sm text-gray-600 mb-1">Orders</div>
                <div className="font-semibold">
                  {custDetail?.summary?.orders || 0}
                </div>
              </div>
              <div className="p-4 rounded-xl border bg-gray-50">
                <div className="text-sm text-gray-600 mb-1">Total Spend</div>
                <div className="font-semibold">
                  {formatTHB(Number(custDetail?.summary?.total || 0))}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Order Code</th>
                    <th className="py-2 pr-4">Subtotal</th>
                    <th className="py-2 pr-4">Delivery</th>
                    <th className="py-2 pr-4">Total</th>
                    <th className="py-2 pr-4">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(custDetail.orders || []).map((o) => (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        {String(o.date).slice(0, 10)}
                      </td>
                      <td className="py-2 pr-4">{o.order_code || "—"}</td>
                      <td className="py-2 pr-4">
                        {formatTHB(Number(o.subtotal || 0))}
                      </td>
                      <td className="py-2 pr-4">
                        {formatTHB(Number(o.delivery_fee || 0))}
                      </td>
                      <td className="py-2 pr-4 font-semibold">
                        {formatTHB(Number(o.total || 0))}
                      </td>
                      <td className="py-2 pr-4">{o.notes || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
