import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { fmt, currencySymbol, CURRENCIES } from "@/lib/utils_app";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend, ReferenceLine,
} from "recharts";
import { TrendUp, TrendDown, Receipt, ArrowsDownUp, FileText, Coins, ArrowsClockwise } from "@phosphor-icons/react";

const COLORS = [
  "#0f172a", "#1d4ed8", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#65a30d",
  "#db2777", "#4338ca", "#0d9488", "#92400e",
];

function compactCurrency(value, cur) {
  const symbol = currencySymbol(cur);
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${symbol}${abs.toFixed(0)}`;
}

function ChartTooltip({ active, payload, label, cur }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-lg px-3 py-2">
      {label && <div className="text-xs font-semibold text-slate-700 mb-1.5">{label}</div>}
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={p.dataKey || p.name} className="flex items-center justify-between gap-6 text-xs">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color || p.payload?.fill }} />
              {p.name}
            </span>
            <span className="font-semibold text-slate-900">{fmt(p.value, cur)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KPI({ label, value, delta, Icon, tone = "default", testId }) {
  return (
    <Card className="p-5 border-slate-200 shadow-none" data-testid={testId}>
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
        {Icon && <Icon size={18} weight="duotone" className="text-slate-400" />}
      </div>
      <div className={`mt-2 text-3xl font-extrabold tracking-tight ${tone === "danger" ? "text-red-600" : tone === "success" ? "text-emerald-700" : "text-slate-900"}`} style={{ fontFamily: "Manrope, sans-serif" }}>
        {value}
      </div>
      {delta && <div className="text-xs text-slate-500 mt-2">{delta}</div>}
    </Card>
  );
}

function ExchangeRates({ base }) {
  const [rates, setRates] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const { data } = await api.get("/exchange-rates", { params: { base } });
      setRates(data.rates);
      setLastUpdated(data.last_updated);
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [base]);

  return (
    <Card className="p-6 border-slate-200 shadow-none" data-testid="exchange-rates-card">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Markets</div>
          <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>Live exchange rates</div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="h-8 w-8 grid place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          data-testid="exchange-rates-refresh"
          title="Refresh rates"
        >
          <ArrowsClockwise size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="text-xs text-slate-500 mb-4">1 {base} equals</div>

      {error ? (
        <div className="text-sm text-slate-500 py-6 text-center" data-testid="exchange-rates-error">Couldn't load exchange rates. Check your internet connection.</div>
      ) : loading && !rates ? (
        <div className="text-sm text-slate-500 py-6 text-center">Loading rates...</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CURRENCIES.filter((c) => c.code !== base).map((c) => (
            <div key={c.code} className="flex items-center justify-between border border-slate-100 rounded-md px-3 py-2">
              <span className="text-sm font-medium text-slate-600">{c.code}</span>
              <span className="text-sm font-semibold" data-testid={`fx-rate-${c.code}`}>
                {rates?.[c.code] != null ? rates[c.code].toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {lastUpdated && (
        <div className="text-[11px] text-slate-400 mt-4">Updated {lastUpdated} — informational only, not used in any totals</div>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const cur = user?.currency || "USD";

  useEffect(() => {
    api.get("/reports/dashboard").then((r) => setData(r.data));
  }, []);

  if (!data) return <div className="p-10 text-slate-500" data-testid="dashboard-loading">Loading dashboard...</div>;

  const t = data.totals;
  const chartData = data.monthly.map((m) => {
    const [year, month] = m.month.split("-");
    const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
    return { ...m, month: label };
  });

  return (
    <div className="p-8 space-y-8" data-testid="dashboard-page">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Overview</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Welcome, {user?.name?.split(" ")[0]}</h1>
          <div className="text-sm text-slate-500 mt-1">Financial pulse for {user?.business_name}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Revenue" value={fmt(t.income, cur)} Icon={TrendUp} tone="success" testId="kpi-income" />
        <KPI label="Expenses" value={fmt(t.expenses, cur)} Icon={TrendDown} tone="danger" testId="kpi-expenses" />
        <KPI label="Net Profit" value={fmt(t.net, cur)} Icon={ArrowsDownUp} tone={t.net >= 0 ? "success" : "danger"} testId="kpi-net" />
        <KPI label="Outstanding" value={fmt(t.invoices_outstanding, cur)} Icon={FileText} testId="kpi-outstanding" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6 border-slate-200 shadow-none" data-testid="chart-cashflow">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Cash flow</div>
              <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>Monthly revenue vs expenses</div>
            </div>
            <div className="flex gap-4 text-xs">
              <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600"></span> Revenue</div>
              <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-600"></span> Expenses</div>
              <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-900"></span> Net</div>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ left: 4, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => compactCurrency(v, cur)} width={56} />
                <Tooltip content={<ChartTooltip cur={cur} />} />
                <ReferenceLine y={0} stroke="#cbd5e1" />
                <Line type="monotone" dataKey="income" name="Revenue" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="expense" name="Expenses" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="net" name="Net" stroke="#0f172a" strokeWidth={2.5} dot={{ r: 3, fill: "#0f172a" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-slate-200 shadow-none" data-testid="chart-expenses-cat">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Breakdown</div>
          <div className="font-bold text-lg mb-4" style={{ fontFamily: "Manrope, sans-serif" }}>Expense categories</div>
          {data.categories.expense.length === 0 ? (
            <div className="text-sm text-slate-500 py-10 text-center">No expense data yet</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={data.categories.expense}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    outerRadius={80}
                    innerRadius={45}
                    label={({ percent }) => (percent * 100 >= 6 ? `${(percent * 100).toFixed(0)}%` : "")}
                    labelLine={false}
                    fontSize={11}
                    isAnimationActive={false}
                  >
                    {data.categories.expense.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="#fff" strokeWidth={1.5} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip cur={cur} />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, lineHeight: "18px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6 border-slate-200 shadow-none" data-testid="chart-net">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Business growth</div>
          <div className="font-bold text-lg mb-4" style={{ fontFamily: "Manrope, sans-serif" }}>Net profit by month</div>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ left: 4, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => compactCurrency(v, cur)} width={56} />
                <Tooltip content={<ChartTooltip cur={cur} />} cursor={{ fill: "#f1f5f9" }} />
                <ReferenceLine y={0} stroke="#cbd5e1" />
                <Bar dataKey="net" name="Net profit" radius={[4, 4, 4, 4]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.net >= 0 ? "#059669" : "#dc2626"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-slate-200 shadow-none">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Tax</div>
          <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>Snapshot</div>
          <div className="mt-4 space-y-3">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-sm text-slate-600">Tax collected</span>
              <span className="font-semibold" data-testid="tax-collected">{fmt(t.tax_collected, cur)}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-sm text-slate-600">Paid invoices</span>
              <span className="font-semibold">{fmt(t.invoices_paid, cur)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-slate-600">Transactions</span>
              <span className="font-semibold">{data.transactions_count}</span>
            </div>
          </div>
        </Card>
      </div>

      <ExchangeRates base={cur} />
    </div>
  );
}
