import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmt, fmtDate, currencySymbol, CURRENCIES, loadPersisted, savePersisted } from "@/lib/utils_app";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend, ReferenceLine,
} from "recharts";
import { TrendUp, TrendDown, ArrowsDownUp, FileText, ArrowsClockwise, ArrowsOut, Warning } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/context/ThemeContext";

const COLORS = [
  "#0f172a", "#1d4ed8", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#65a30d",
  "#db2777", "#4338ca", "#0d9488", "#92400e",
];

const INVOICE_STATUS_COLORS = { draft: "#94a3b8", sent: "#2563eb", paid: "#059669", overdue: "#dc2626" };
const INVOICE_STATUS_COLORS_DARK = { draft: "#94a3b8", sent: "#60a5fa", paid: "#34d399", overdue: "#f87171" };
const COLORS_DARK = [
  "#e2e8f0", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee", "#a3e635",
  "#f472b6", "#818cf8", "#2dd4bf", "#f59e0b",
];
const INVOICE_STATUS_LABELS = { draft: "Draft", sent: "Sent", paid: "Paid", overdue: "Overdue" };

function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    colors: dark ? COLORS_DARK : COLORS,
    invoiceStatus: dark ? INVOICE_STATUS_COLORS_DARK : INVOICE_STATUS_COLORS,
    grid: dark ? "#2a3548" : "#e2e8f0",
    axis: dark ? "#94a3b8" : "#64748b",
    axisLine: dark ? "#2a3548" : "#e2e8f0",
    cursor: dark ? "#1e293b" : "#f1f5f9",
    refLine: dark ? "#475569" : "#cbd5e1",
    green: dark ? "#34d399" : "#059669",
    red: dark ? "#f87171" : "#dc2626",
    pieStroke: dark ? "#1a2332" : "#fff",
    muted: dark ? "#475569" : "#cbd5e1",
  };
}

// The expanded dialog caps at 78vh (see ChartCard); its header + filter row +
// padding measures ~130px regardless of chart type, so sizing the chart to
// the remaining space (with a floor for very short windows) keeps the whole
// chart visible without the dialog needing to scroll. Capped shorter than
// the dialog's width grows wide, so the expanded chart reads as a wide
// rectangle rather than a tall, near-square panel.
const BIG_CHART_HEIGHT = "max(320px, calc(78vh - 130px))";

function todayParts() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function weeksInMonth(year, month) {
  return Math.ceil(new Date(year, month, 0).getDate() / 7);
}
function defaultPeriod(granularity) {
  const { year, month, day } = todayParts();
  if (granularity === "day") return { date: todayISO() };
  if (granularity === "week") return { year, month, week: Math.ceil(day / 7) };
  if (granularity === "month") return { year, month };
  return { year };
}

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
    <div className="bg-card border border-slate-200 rounded-md shadow-lg px-3 py-2">
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

// Recharts' Pie tooltip payload doesn't include each slice's percent (only
// the sector's own rendering geometry does), so it's computed here directly
// from the same category totals the chart already has.
function PieTooltip({ active, payload, cur, total }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const percent = total ? Math.round((p.value / total) * 100) : 0;
  return (
    <div className="bg-card border border-slate-200 rounded-md shadow-lg px-3 py-2">
      <div className="flex items-center justify-between gap-6 text-xs">
        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.payload?.fill }} />
          {p.name}
        </span>
        <span className="font-semibold text-slate-900">{fmt(p.value, cur)} <span className="text-slate-400 font-normal">({percent}%)</span></span>
      </div>
    </div>
  );
}

function KPI({ label, value, delta, Icon, tone = "default", testId }) {
  return (
    <Card className="p-5 border-slate-200 shadow-none min-w-0" data-testid={testId}>
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
        {Icon && <Icon size={18} weight="duotone" className="text-slate-400 shrink-0" />}
      </div>
      <div className={`mt-2 text-3xl font-extrabold tracking-tight truncate ${tone === "danger" ? "text-red-600 dark:text-red-400" : tone === "success" ? "text-emerald-700 dark:text-emerald-400" : "text-slate-900"}`} style={{ fontFamily: "Manrope, sans-serif" }} title={value}>
        {value}
      </div>
      {delta && <div className="text-xs text-slate-500 mt-2">{delta}</div>}
    </Card>
  );
}

// Date range for the top KPI row only (Revenue/Expenses/Net Profit - flows
// that naturally belong to a period). Outstanding is left out on purpose:
// it's a current balance (invoices unpaid right now), not a flow, so it
// wouldn't mean the same thing scoped to a past range - see KPI row below.
const DASHBOARD_RANGE_KEY = "ledgerly:dashboard:kpi-range";

function KpiRangeFilter({ range, setRange }) {
  const isAllTime = !range.start && !range.end;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Input
        type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })}
        className="h-7 w-[135px] text-xs md:text-xs px-2" data-testid="dashboard-kpi-range-start"
      />
      <span className="text-xs text-slate-400">to</span>
      <Input
        type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })}
        className="h-7 w-[135px] text-xs md:text-xs px-2" data-testid="dashboard-kpi-range-end"
      />
      {!isAllTime && (
        <button
          type="button" onClick={() => setRange({ start: "", end: "" })}
          className="text-xs text-slate-400 hover:text-slate-700 underline underline-offset-2"
          data-testid="dashboard-kpi-range-clear"
        >
          All time
        </button>
      )}
    </div>
  );
}

// Compact per-chart period filter: a granularity toggle plus the exact-period
// picker for that granularity (a specific day / a week-of-month / a specific
// month / a specific year — never a range).
function ChartFilterBar({ granularity, setGranularity, period, setPeriod, testPrefix }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Select
        value={granularity}
        onValueChange={(g) => { setGranularity(g); setPeriod(defaultPeriod(g)); }}
      >
        <SelectTrigger className="h-7 w-[74px] text-xs md:text-xs px-2" data-testid={`${testPrefix}-granularity`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="day">Day</SelectItem>
          <SelectItem value="week">Week</SelectItem>
          <SelectItem value="month">Month</SelectItem>
          <SelectItem value="year">Year</SelectItem>
        </SelectContent>
      </Select>

      {granularity === "day" && (
        <Input
          type="date"
          value={period.date}
          onChange={(e) => setPeriod({ date: e.target.value })}
          className="h-7 w-[150px] text-xs md:text-xs px-2"
          data-testid={`${testPrefix}-date`}
        />
      )}

      {granularity === "week" && (
        <>
          <MonthYearPicker
            year={period.year}
            month={period.month}
            onChange={(y, m) => setPeriod({ year: y, month: m, week: 1 })}
            testPrefix={testPrefix}
          />
          <Select value={String(period.week)} onValueChange={(w) => setPeriod({ ...period, week: Number(w) })}>
            <SelectTrigger className="h-7 w-[90px] text-xs md:text-xs px-2" data-testid={`${testPrefix}-week`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: weeksInMonth(period.year, period.month) }, (_, i) => i + 1).map((w) => (
                <SelectItem key={w} value={String(w)}>Week {w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}

      {granularity === "month" && (
        <MonthYearPicker
          year={period.year}
          month={period.month}
          onChange={(y, m) => setPeriod({ year: y, month: m })}
          testPrefix={testPrefix}
        />
      )}

      {granularity === "year" && (
        <Input
          type="number"
          value={period.year}
          onChange={(e) => setPeriod({ year: Number(e.target.value) })}
          className="h-7 w-[80px] text-xs md:text-xs px-2"
          data-testid={`${testPrefix}-year`}
        />
      )}
    </div>
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Explicit Month + Year dropdowns instead of a native <input type="month">,
// whose browser picker UI can be small/unreliable — this way both are always
// directly clickable rather than requiring arrow-key stepping.
function MonthYearPicker({ year, month, onChange, testPrefix }) {
  return (
    <>
      <Select value={String(month)} onValueChange={(m) => onChange(year, Number(m))}>
        <SelectTrigger className="h-7 w-[70px] text-xs md:text-xs px-2" data-testid={`${testPrefix}-month`}><SelectValue /></SelectTrigger>
        <SelectContent>
          {MONTH_NAMES.map((name, i) => (
            <SelectItem key={name} value={String(i + 1)}>{name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        value={year}
        onChange={(e) => onChange(Number(e.target.value), month)}
        className="h-7 w-[70px] text-xs md:text-xs px-2"
        data-testid={`${testPrefix}-year`}
      />
    </>
  );
}

// Remembers each chart's last granularity/period in localStorage (keyed per
// chart) so returning to the dashboard restores the last view instead of
// resetting to today's default.
function useSeries(chartId, initialGranularity) {
  const storageKey = `ledgerly:dashboard:${chartId}`;
  const [granularity, setGranularity] = useState(() => loadPersisted(storageKey, {}).granularity || initialGranularity);
  const [period, setPeriod] = useState(() => {
    const saved = loadPersisted(storageKey, {});
    return saved.period || defaultPeriod(saved.granularity || initialGranularity);
  });
  const [data, setData] = useState(null);

  useEffect(() => {
    savePersisted(storageKey, { granularity, period });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, granularity, JSON.stringify(period)]);

  useEffect(() => {
    api.get("/reports/series", { params: { granularity, ...period } }).then((r) => setData(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, JSON.stringify(period)]);

  return { granularity, setGranularity, period, setPeriod, data };
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

function ChartHeader({ eyebrow, title, granularity, setGranularity, period, setPeriod, testPrefix, windowLabel, onExpand }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{eyebrow}</div>
        <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>{title}</div>
        {windowLabel && <div className="text-xs text-slate-400">{windowLabel}</div>}
      </div>
      <div className="flex items-center gap-1.5">
        <ChartFilterBar granularity={granularity} setGranularity={setGranularity} period={period} setPeriod={setPeriod} testPrefix={testPrefix} />
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="h-7 w-7 shrink-0 grid place-items-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title="Expand"
            data-testid={`${testPrefix}-expand`}
          >
            <ArrowsOut size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// Wraps a chart card so clicking the expand icon opens the same chart, same
// filter, same live state, larger and in a dialog for closer inspection.
function ChartCard({ testId, eyebrow, title, granularity, setGranularity, period, setPeriod, testPrefix, windowLabel, renderBody }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Card className="p-6 border-slate-200 shadow-none" data-testid={testId}>
        <ChartHeader
          eyebrow={eyebrow} title={title}
          granularity={granularity} setGranularity={setGranularity}
          period={period} setPeriod={setPeriod}
          testPrefix={testPrefix} windowLabel={windowLabel}
          onExpand={() => setExpanded(true)}
        />
        {renderBody(false)}
      </Card>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-7xl max-h-[78vh] overflow-y-auto" data-testid={`${testPrefix}-dialog`}>
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap -mt-2 mb-1">
            {windowLabel && <div className="text-sm text-slate-500">{windowLabel}</div>}
            <ChartFilterBar granularity={granularity} setGranularity={setGranularity} period={period} setPeriod={setPeriod} testPrefix={`${testPrefix}-modal`} />
          </div>
          {renderBody(true)}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CashFlowChart({ cur }) {
  const { granularity, setGranularity, period, setPeriod, data } = useSeries("cashflow", "month");
  const ct = useChartTheme();
  if (!data) return <Card className="p-6 border-slate-200 shadow-none h-64 animate-pulse" data-testid="chart-cashflow" />;
  const renderBody = (big) => (
    <div style={{ height: big ? BIG_CHART_HEIGHT : 176 }}>
      <ResponsiveContainer>
        <BarChart data={data.series} margin={big ? { left: 8, right: 16, top: 8 } : { left: 4, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
          <XAxis dataKey="label" stroke={ct.axis} fontSize={big ? 13 : 10} tickLine={false} axisLine={{ stroke: ct.axisLine }} />
          <YAxis stroke={ct.axis} fontSize={big ? 13 : 10} tickLine={false} axisLine={false} tickFormatter={(v) => compactCurrency(v, cur)} width={big ? 64 : 48} />
          <Tooltip content={<ChartTooltip cur={cur} />} cursor={{ fill: ct.cursor }} />
          <ReferenceLine y={0} stroke={ct.refLine} />
          <Bar dataKey="income" name="Revenue" fill={ct.green} radius={[3, 3, 0, 0]} />
          <Bar dataKey="expense" name="Expenses" fill={ct.red} radius={[3, 3, 0, 0]} />
          {big && <Legend wrapperStyle={{ fontSize: 13 }} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <ChartCard
      testId="chart-cashflow" eyebrow="Cash flow" title="Revenue vs expenses"
      granularity={granularity} setGranularity={setGranularity} period={period} setPeriod={setPeriod}
      testPrefix="cashflow" windowLabel={data.window.label} renderBody={renderBody}
    />
  );
}

function ExpensesPieChart({ cur }) {
  const { granularity, setGranularity, period, setPeriod, data } = useSeries("expenses-cat", "month");
  const ct = useChartTheme();
  if (!data) return <Card className="p-6 border-slate-200 shadow-none h-64 animate-pulse" data-testid="chart-expenses-cat" />;
  const expenseTotal = data.categories.expense.reduce((s, c) => s + c.value, 0);
  const renderBody = (big) => (
    data.categories.expense.length === 0 ? (
      <div className="text-sm text-slate-500 py-10 text-center">No expense data for this period</div>
    ) : (
      <div style={{ height: big ? BIG_CHART_HEIGHT : 208 }}>
        <ResponsiveContainer>
          <PieChart margin={big ? { top: 20, right: 8, left: 8, bottom: 0 } : { top: 14, right: 8, left: 8, bottom: 0 }}>
            <Pie
              data={data.categories.expense}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy={big ? "44%" : "42%"}
              outerRadius={big ? "68%" : 58}
              innerRadius={big ? "37%" : 32}
              label={({ percent }) => (percent * 100 >= 6 ? `${(percent * 100).toFixed(0)}%` : "")}
              labelLine={false}
              fontSize={big ? 14 : 10}
            >
              {data.categories.expense.map((_, i) => <Cell key={i} fill={ct.colors[i % ct.colors.length]} stroke={ct.pieStroke} strokeWidth={1.5} />)}
            </Pie>
            <Tooltip content={<PieTooltip cur={cur} total={expenseTotal} />} />
            <Legend iconType="circle" iconSize={big ? 10 : 7} wrapperStyle={{ fontSize: big ? 13 : 10, lineHeight: big ? "22px" : "16px" }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  );
  return (
    <ChartCard
      testId="chart-expenses-cat" eyebrow="Breakdown" title="Expense categories"
      granularity={granularity} setGranularity={setGranularity} period={period} setPeriod={setPeriod}
      testPrefix="expenses-cat" windowLabel={data.window.label} renderBody={renderBody}
    />
  );
}

function ProfitLossChart({ cur }) {
  const { granularity, setGranularity, period, setPeriod, data } = useSeries("pnl", "month");
  const ct = useChartTheme();
  if (!data) return <Card className="p-6 border-slate-200 shadow-none h-64 animate-pulse" data-testid="chart-net" />;
  const renderBody = (big) => (
    <div style={{ height: big ? BIG_CHART_HEIGHT : 176 }}>
      <ResponsiveContainer>
        <BarChart data={data.series} margin={big ? { left: 8, right: 16, top: 8 } : { left: 4, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
          <XAxis dataKey="label" stroke={ct.axis} fontSize={big ? 13 : 10} tickLine={false} axisLine={{ stroke: ct.axisLine }} />
          <YAxis stroke={ct.axis} fontSize={big ? 13 : 10} tickLine={false} axisLine={false} tickFormatter={(v) => compactCurrency(v, cur)} width={big ? 64 : 48} />
          <Tooltip content={<ChartTooltip cur={cur} />} cursor={{ fill: ct.cursor }} />
          <ReferenceLine y={0} stroke={ct.refLine} />
          <Bar dataKey="net" name="Net profit" radius={[4, 4, 4, 4]}>
            {data.series.map((d, i) => <Cell key={i} fill={d.net >= 0 ? ct.green : ct.red} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <ChartCard
      testId="chart-net" eyebrow="Business growth" title="Profit & loss"
      granularity={granularity} setGranularity={setGranularity} period={period} setPeriod={setPeriod}
      testPrefix="pnl" windowLabel={data.window.label} renderBody={renderBody}
    />
  );
}

function SalesChart({ cur }) {
  const { granularity, setGranularity, period, setPeriod, data } = useSeries("sales", "month");
  const ct = useChartTheme();
  if (!data) return <Card className="p-6 border-slate-200 shadow-none h-64 animate-pulse" data-testid="chart-sales" />;
  const renderBody = (big) => (
    <div style={{ height: big ? BIG_CHART_HEIGHT : 176 }}>
      <ResponsiveContainer>
        <LineChart data={data.series} margin={big ? { left: 8, right: 16, top: 8 } : { left: 4, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
          <XAxis dataKey="label" stroke={ct.axis} fontSize={big ? 13 : 10} tickLine={false} axisLine={{ stroke: ct.axisLine }} />
          <YAxis stroke={ct.axis} fontSize={big ? 13 : 10} tickLine={false} axisLine={false} tickFormatter={(v) => compactCurrency(v, cur)} width={big ? 64 : 48} />
          <Tooltip content={<ChartTooltip cur={cur} />} />
          <Line type="monotone" dataKey="income" name="Sales" stroke={ct.green} strokeWidth={big ? 3 : 2.5} dot={{ r: big ? 5 : 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <ChartCard
      testId="chart-sales" eyebrow="Trend" title="Sales"
      granularity={granularity} setGranularity={setGranularity} period={period} setPeriod={setPeriod}
      testPrefix="sales" windowLabel={data.window.label} renderBody={renderBody}
    />
  );
}

// A horizontal segmented bar with amounts above and labels below each
// segment, sized proportionally — used by the invoices summary.
function SegmentedBar({ segments, cur, big }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div>
      <div className="flex justify-between items-end mb-2">
        {segments.map((s) => (
          <div key={s.label} className="min-w-0">
            <div className={`font-extrabold truncate ${big ? "text-4xl" : "text-base"}`} style={{ fontFamily: "Manrope, sans-serif" }} title={fmt(s.value, cur)}>{fmt(s.value, cur)}</div>
            <div className={`text-slate-500 ${big ? "text-base" : "text-xs"}`}>{s.label}</div>
          </div>
        ))}
      </div>
      <div className={`flex ${big ? "h-5" : "h-2.5"} rounded-full overflow-hidden bg-slate-100`}>
        {segments.map((s) => (
          <div
            key={s.label}
            className="transition-[width] duration-500 ease-out"
            style={{ width: `${total ? (s.value / total) * 100 : 50}%`, background: s.color }}
          />
        ))}
      </div>
    </div>
  );
}

function InvoicesChart({ cur }) {
  const { granularity, setGranularity, period, setPeriod, data } = useSeries("invoices", "month");
  const ct = useChartTheme();
  if (!data) return <Card className="p-6 border-slate-200 shadow-none h-64 animate-pulse" data-testid="chart-invoices" />;

  const statusTotals = { draft: 0, sent: 0, paid: 0, overdue: 0 };
  data.series.forEach((p) => { for (const k in p.invoices) statusTotals[k] += p.invoices[k]; });
  const paid = statusTotals.paid;
  const outstanding = statusTotals.draft + statusTotals.sent + statusTotals.overdue;
  const notYetDue = statusTotals.draft + statusTotals.sent;
  const overdue = statusTotals.overdue;

  const renderBody = (big) => (
    <div className={big ? "space-y-14 py-6" : "space-y-5"}>
      <SegmentedBar
        cur={cur}
        big={big}
        segments={[
          { label: "Paid", value: paid, color: ct.invoiceStatus.paid },
          { label: "Outstanding", value: outstanding, color: ct.muted },
        ]}
      />
      <SegmentedBar
        cur={cur}
        big={big}
        segments={[
          { label: "Overdue", value: overdue, color: ct.invoiceStatus.overdue },
          { label: "Not yet due", value: notYetDue, color: ct.invoiceStatus.sent },
        ]}
      />
    </div>
  );

  return (
    <ChartCard
      testId="chart-invoices" eyebrow="Invoicing" title="Invoices"
      granularity={granularity} setGranularity={setGranularity} period={period} setPeriod={setPeriod}
      testPrefix="invoices" windowLabel={data.window.label} renderBody={renderBody}
    />
  );
}

// Self-contained: fetches its own inventory data so it can render nothing
// when nothing is low, instead of coupling the whole dashboard's load state
// to an unrelated module.
function LowStockBanner() {
  const navigate = useNavigate();
  const [lowItems, setLowItems] = useState([]);

  useEffect(() => {
    api.get("/inventory").then((r) => {
      const low = r.data.filter((i) => Number(i.reorder_point) > 0 && Number(i.quantity) <= Number(i.reorder_point));
      setLowItems(low);
    });
  }, []);

  if (lowItems.length === 0) return null;

  return (
    <Card
      className="p-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 shadow-none flex items-center gap-3 cursor-pointer hover:bg-red-100/70 dark:hover:bg-red-950/50 transition-colors"
      onClick={() => navigate("/inventory")}
      data-testid="dashboard-low-stock-banner"
    >
      <Warning size={20} weight="fill" className="text-red-600 dark:text-red-400 shrink-0" />
      <div className="text-sm text-red-700 dark:text-red-400 flex-1">
        <span className="font-semibold">{lowItems.length} inventory item{lowItems.length > 1 ? "s" : ""} running low: </span>
        {lowItems.map((i) => i.name).join(", ")}
      </div>
      <span className="text-xs font-semibold text-red-700 dark:text-red-400 shrink-0">View inventory →</span>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [range, setRange] = useState(() => loadPersisted(DASHBOARD_RANGE_KEY, { start: "", end: "" }));
  const cur = user?.currency || "USD";
  const isAllTime = !range.start && !range.end;

  useEffect(() => { savePersisted(DASHBOARD_RANGE_KEY, range); }, [range]);

  useEffect(() => {
    api.get("/reports/dashboard", { params: { start: range.start || undefined, end: range.end || undefined } })
      .then((r) => setData(r.data));
  }, [range.start, range.end]);

  if (!data) return <div className="p-10 text-slate-500" data-testid="dashboard-loading">Loading dashboard...</div>;

  const t = data.totals;

  return (
    <div className="p-8 space-y-6" data-testid="dashboard-page">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Overview</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Welcome, {user?.name?.split(" ")[0]}</h1>
        <div className="text-sm text-slate-500 mt-1">
          Financial pulse for {user?.business_name} — {isAllTime ? "all-time totals" : `${fmtDate(range.start)} → ${fmtDate(range.end)}`}
        </div>
      </div>

      <LowStockBanner />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Revenue · Expenses · Net Profit period</div>
        <KpiRangeFilter range={range} setRange={setRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Revenue" value={fmt(t.income, cur)} Icon={TrendUp} tone="success" testId="kpi-income" />
        <KPI label="Expenses" value={fmt(t.expenses, cur)} Icon={TrendDown} tone="danger" testId="kpi-expenses" />
        <KPI label="Net Profit" value={fmt(t.net, cur)} Icon={ArrowsDownUp} tone={t.net >= 0 ? "success" : "danger"} testId="kpi-net" />
        <KPI label="Outstanding" value={fmt(t.invoices_outstanding, cur)} delta={!isAllTime ? "As of today, not the selected period" : undefined} Icon={FileText} testId="kpi-outstanding" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CashFlowChart cur={cur} />
        <ExpensesPieChart cur={cur} />
        <ProfitLossChart cur={cur} />
        <SalesChart cur={cur} />
        <InvoicesChart cur={cur} />

        <Card className="p-6 border-slate-200 shadow-none">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Tax</div>
          <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>Snapshot (all-time)</div>
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
