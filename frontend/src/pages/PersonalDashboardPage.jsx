import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AnimatedBar from "@/components/AnimatedBar";
import { fmt, fmtDate, currencySymbol, loadPersisted, savePersisted } from "@/lib/utils_app";
import { TrendUp, TrendDown, ArrowsDownUp, PiggyBank, Calendar, Target, Article, ArrowsOut } from "@phosphor-icons/react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ReferenceLine,
} from "recharts";

// Same palette as the business DashboardPage.jsx's useChartTheme - kept in
// sync deliberately so Personal and Business charts read as one design
// system rather than two.
const COLORS = [
  "#0f172a", "#1d4ed8", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#65a30d",
  "#db2777", "#4338ca", "#0d9488", "#92400e",
];
const COLORS_DARK = [
  "#e2e8f0", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee", "#a3e635",
  "#f472b6", "#818cf8", "#2dd4bf", "#f59e0b",
];

function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    colors: dark ? COLORS_DARK : COLORS,
    grid: dark ? "#2a3548" : "#e2e8f0",
    axis: dark ? "#94a3b8" : "#64748b",
    axisLine: dark ? "#2a3548" : "#e2e8f0",
    cursor: dark ? "#1e293b" : "#f1f5f9",
    refLine: dark ? "#475569" : "#cbd5e1",
    green: dark ? "#34d399" : "#059669",
    red: dark ? "#f87171" : "#dc2626",
    pieStroke: dark ? "#1a2332" : "#fff",
  };
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

// Recharts' Pie tooltip payload doesn't carry each slice's percent, so it's
// computed here from the same category totals the chart already has.
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

function KPI({ label, value, Icon, tone = "default", testId }) {
  return (
    <Card className="p-5 border-slate-200 shadow-none min-w-0" data-testid={testId}>
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
        {Icon && <Icon size={18} weight="duotone" className="text-slate-400 shrink-0" />}
      </div>
      <div className={`mt-2 text-3xl font-extrabold tracking-tight truncate ${tone === "danger" ? "text-red-600 dark:text-red-400" : tone === "success" ? "text-emerald-700 dark:text-emerald-400" : "text-slate-900"}`} style={{ fontFamily: "Manrope, sans-serif" }} title={value}>
        {value}
      </div>
    </Card>
  );
}

// Date range for the top KPI row (Income/Expenses/Net - flows, mirroring the
// business dashboard's adjustable Revenue/Expenses/Net Profit). Defaults to
// the current calendar month, matching this dashboard's original behavior.
const DASHBOARD_RANGE_KEY = "ledgerly:personal-dashboard:kpi-range";

function firstDayOfMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}
function defaultKpiRange() {
  return { start: firstDayOfMonth(), end: todayISO() };
}

function KpiRangeFilter({ range, setRange }) {
  const isCurrentMonth = range.start === defaultKpiRange().start && range.end === defaultKpiRange().end;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Input
        type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })}
        className="h-7 w-[135px] text-xs md:text-xs px-2" data-testid="personal-kpi-range-start"
      />
      <span className="text-xs text-slate-400">to</span>
      <Input
        type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })}
        className="h-7 w-[135px] text-xs md:text-xs px-2" data-testid="personal-kpi-range-end"
      />
      {!isCurrentMonth && (
        <button
          type="button" onClick={() => setRange(defaultKpiRange())}
          className="text-xs text-slate-400 hover:text-slate-700 underline underline-offset-2"
          data-testid="personal-kpi-range-clear"
        >
          This month
        </button>
      )}
    </div>
  );
}

// ---- Chart filters + expand, mirroring the business DashboardPage.jsx's
// ChartFilterBar/ChartHeader/ChartCard/useSeries exactly (duplicated here,
// not imported, matching this app's existing Personal/Business separation)
// but pointed at /personal/reports/series instead of /reports/series. ----

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

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

// Remembers each chart's last granularity/period in localStorage (keyed per
// chart, under a "personal-dashboard" namespace so it never collides with
// the business dashboard's own saved state) so returning to the dashboard
// restores the last view instead of resetting to today's default.
function useSeries(chartId, initialGranularity) {
  const storageKey = `ledgerly:personal-dashboard:${chartId}`;
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
    api.get("/personal/reports/series", { params: { granularity, ...period } }).then((r) => setData(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, JSON.stringify(period)]);

  return { granularity, setGranularity, period, setPeriod, data };
}

// The expanded dialog caps at 78vh; sizing the chart to the remaining space
// (after header + filter row + padding, ~130px) keeps it fully visible
// without the dialog needing to scroll - same sizing business uses.
const BIG_CHART_HEIGHT = "max(320px, calc(78vh - 130px))";

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

function IncomeExpenseChart({ cur }) {
  const { granularity, setGranularity, period, setPeriod, data } = useSeries("income-expense", "month");
  const ct = useChartTheme();
  if (!data) return <Card className="p-6 border-slate-200 shadow-none h-64 animate-pulse" data-testid="personal-chart-income-expense" />;
  const renderBody = (big) => (
    <div style={{ height: big ? BIG_CHART_HEIGHT : 208 }}>
      <ResponsiveContainer>
        <BarChart data={data.series} margin={big ? { left: 8, right: 16, top: 8 } : { left: 4, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
          <XAxis dataKey="label" stroke={ct.axis} fontSize={big ? 13 : 11} tickLine={false} axisLine={{ stroke: ct.axisLine }} />
          <YAxis stroke={ct.axis} fontSize={big ? 13 : 11} tickLine={false} axisLine={false} tickFormatter={(v) => compactCurrency(v, cur)} width={big ? 64 : 52} />
          <Tooltip content={<ChartTooltip cur={cur} />} cursor={{ fill: ct.cursor }} />
          <ReferenceLine y={0} stroke={ct.refLine} />
          <Bar dataKey="income" name="Income" fill={ct.green} radius={[3, 3, 0, 0]} />
          <Bar dataKey="expense" name="Expenses" fill={ct.red} radius={[3, 3, 0, 0]} />
          <Legend iconType="circle" iconSize={big ? 10 : 8} wrapperStyle={{ fontSize: big ? 13 : 11 }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <ChartCard
      testId="personal-chart-income-expense" eyebrow="Trend" title="Income vs expenses"
      granularity={granularity} setGranularity={setGranularity} period={period} setPeriod={setPeriod}
      testPrefix="personal-income-expense" windowLabel={data.window.label} renderBody={renderBody}
    />
  );
}

function ExpenseCategoriesChart({ cur }) {
  const { granularity, setGranularity, period, setPeriod, data } = useSeries("expense-categories", "month");
  const ct = useChartTheme();
  if (!data) return <Card className="p-6 border-slate-200 shadow-none h-64 animate-pulse" data-testid="personal-chart-expense-categories" />;
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
      testId="personal-chart-expense-categories" eyebrow="Breakdown" title="Expense categories"
      granularity={granularity} setGranularity={setGranularity} period={period} setPeriod={setPeriod}
      testPrefix="personal-expense-categories" windowLabel={data.window.label} renderBody={renderBody}
    />
  );
}

function ratio(current, target) {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, current / target));
}
function barColor(spent, limit) {
  if (limit <= 0) return "bg-slate-300";
  const r = spent / limit;
  if (r >= 1) return "bg-red-600";
  if (r >= 0.75) return "bg-amber-500";
  return "bg-emerald-600";
}

function BudgetsSnapshot() {
  const navigate = useNavigate();
  const [budgets, setBudgets] = useState(null);

  useEffect(() => {
    api.get("/personal/budgets/summary").then(({ data }) => setBudgets(data));
  }, []);

  if (budgets && budgets.length === 0) return null;

  return (
    <Card
      className="p-6 border-slate-200 shadow-none cursor-pointer hover:border-slate-300 transition-colors"
      onClick={() => navigate("/personal/budgets")}
      data-testid="personal-budgets-snapshot"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Budgets</div>
          <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>This month at a glance</div>
        </div>
        <PiggyBank size={18} weight="duotone" className="text-slate-400 shrink-0" />
      </div>
      {budgets === null ? (
        <div className="text-sm text-slate-500 py-4">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {budgets.map((b) => (
            <div key={b.id} data-testid={`personal-budget-snapshot-${b.id}`}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium">{b.category}</span>
                <span className="text-slate-500">{fmt(b.spent, b.currency)} / {fmt(b.monthly_limit, b.currency)}</span>
              </div>
              <AnimatedBar pct={ratio(b.spent, b.monthly_limit) * 100} colorClass={barColor(b.spent, b.monthly_limit)} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---- Recent transactions / upcoming bills / goal progress - compact
// dashboard summaries, each a self-contained card linking through to its
// full page. ----

function SummaryCard({ eyebrow, title, Icon, to, testId, empty, loading, children }) {
  const navigate = useNavigate();
  return (
    <Card
      className="p-6 border-slate-200 shadow-none cursor-pointer hover:border-slate-300 transition-colors flex flex-col"
      onClick={() => navigate(to)}
      data-testid={testId}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{eyebrow}</div>
          <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>{title}</div>
        </div>
        <Icon size={18} weight="duotone" className="text-slate-400 shrink-0" />
      </div>
      {loading ? (
        <div className="text-sm text-slate-500 py-4">Loading...</div>
      ) : empty ? (
        <div className="text-sm text-slate-500 py-4">{empty}</div>
      ) : (
        <div className="space-y-3 flex-1">{children}</div>
      )}
    </Card>
  );
}

function RecentTransactions({ cur }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    api.get("/personal/transactions").then(({ data }) => setItems(data.slice(0, 5)));
  }, []);

  return (
    <SummaryCard
      eyebrow="Activity" title="Recent transactions" Icon={Article} to="/personal/transactions"
      testId="personal-recent-transactions" loading={items === null} empty={items?.length === 0 ? "No transactions yet." : null}
    >
      {items?.map((t) => (
        <div key={t.id} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0" data-testid={`recent-tx-${t.id}`}>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{t.description || t.category}</div>
            <div className="text-xs text-slate-400">{t.category} · {fmtDate(t.date)}</div>
          </div>
          <div className={`text-sm font-semibold shrink-0 ${t.type === "income" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
            {t.type === "income" ? "+" : "-"}{fmt(t.amount, t.currency || cur)}
          </div>
        </div>
      ))}
    </SummaryCard>
  );
}

const DUE_SOON_DAYS = 3;
function billStatus(dueDate) {
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return "overdue";
  const soon = new Date();
  soon.setDate(soon.getDate() + DUE_SOON_DAYS);
  if (dueDate <= soon.toISOString().slice(0, 10)) return "due-soon";
  return null;
}

function UpcomingBills() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    api.get("/personal/bills").then(({ data }) => setItems(data.slice(0, 5)));
  }, []);

  return (
    <SummaryCard
      eyebrow="Obligations" title="Upcoming bills" Icon={Calendar} to="/personal/bills"
      testId="personal-upcoming-bills" loading={items === null} empty={items?.length === 0 ? "No bills yet." : null}
    >
      {items?.map((b) => {
        const status = billStatus(b.due_date);
        return (
          <div key={b.id} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0" data-testid={`upcoming-bill-${b.id}`}>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{b.name}</div>
              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                {fmtDate(b.due_date)}
                {status === "overdue" && <span className="text-[10px] uppercase tracking-[0.2em] px-1.5 py-0.5 rounded bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400">Overdue</span>}
                {status === "due-soon" && <span className="text-[10px] uppercase tracking-[0.2em] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Due soon</span>}
              </div>
            </div>
            <div className="text-sm font-semibold shrink-0">{fmt(b.amount, b.currency)}</div>
          </div>
        );
      })}
    </SummaryCard>
  );
}

function GoalsProgress() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    api.get("/personal/goals").then(({ data }) => setItems(data));
  }, []);

  return (
    <SummaryCard
      eyebrow="Savings" title="Goal progress" Icon={Target} to="/personal/goals"
      testId="personal-goal-progress" loading={items === null} empty={items?.length === 0 ? "No savings goals yet." : null}
    >
      {items?.map((g) => (
        <div key={g.id} data-testid={`goal-progress-${g.id}`}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="font-medium truncate">{g.name}</span>
            <span className="text-slate-500 shrink-0 ml-2">{fmt(g.current_amount, g.currency)} / {fmt(g.target_amount, g.currency)}</span>
          </div>
          <AnimatedBar pct={ratio(g.current_amount, g.target_amount) * 100} colorClass="bg-emerald-600" />
        </div>
      ))}
    </SummaryCard>
  );
}

export default function PersonalDashboardPage() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState(null);
  const [range, setRange] = useState(() => loadPersisted(DASHBOARD_RANGE_KEY, defaultKpiRange()));
  const cur = user?.currency || "USD";

  useEffect(() => { savePersisted(DASHBOARD_RANGE_KEY, range); }, [range]);

  useEffect(() => {
    api.get("/personal/transactions").then(({ data }) => setTransactions(data));
  }, []);

  if (!transactions) return <div className="p-10 text-slate-500" data-testid="personal-dashboard-loading">Loading dashboard...</div>;

  const inRange = transactions.filter((t) => t.date >= range.start && t.date <= range.end);
  const income = inRange.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount || 0), 0);
  const expense = inRange.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount || 0), 0);
  const net = income - expense;
  const isCurrentMonth = range.start === defaultKpiRange().start && range.end === defaultKpiRange().end;

  return (
    <div className="p-8 space-y-6" data-testid="personal-dashboard-page">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Overview</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Welcome, {user?.name?.split(" ")[0]}</h1>
        <div className="text-sm text-slate-500 mt-1">
          Your personal finances — {isCurrentMonth ? "this month" : `${fmtDate(range.start)} → ${fmtDate(range.end)}`}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Income · Expenses · Net period</div>
        <KpiRangeFilter range={range} setRange={setRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI label="Income" value={fmt(income, cur)} Icon={TrendUp} tone="success" testId="personal-kpi-income" />
        <KPI label="Expenses" value={fmt(expense, cur)} Icon={TrendDown} tone="danger" testId="personal-kpi-expenses" />
        <KPI label="Net" value={fmt(net, cur)} Icon={ArrowsDownUp} tone={net >= 0 ? "success" : "danger"} testId="personal-kpi-net" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <IncomeExpenseChart cur={cur} />
        <ExpenseCategoriesChart cur={cur} />
      </div>

      <BudgetsSnapshot />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RecentTransactions cur={cur} />
        <UpcomingBills />
        <GoalsProgress />
      </div>
    </div>
  );
}
