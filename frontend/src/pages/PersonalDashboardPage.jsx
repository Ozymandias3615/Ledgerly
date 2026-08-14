import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { fmt } from "@/lib/utils_app";
import { TrendUp, TrendDown, ArrowsDownUp } from "@phosphor-icons/react";

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

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function PersonalDashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const cur = user?.currency || "USD";

  useEffect(() => {
    api.get("/personal/transactions").then(({ data }) => {
      const monthKey = currentMonthKey();
      const thisMonth = data.filter((t) => t.date?.slice(0, 7) === monthKey);
      const income = thisMonth.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount || 0), 0);
      const expense = thisMonth.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount || 0), 0);
      setSummary({ income, expense, net: income - expense });
    });
  }, []);

  if (!summary) return <div className="p-10 text-slate-500" data-testid="personal-dashboard-loading">Loading dashboard...</div>;

  return (
    <div className="p-8 space-y-6" data-testid="personal-dashboard-page">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Overview</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Welcome, {user?.name?.split(" ")[0]}</h1>
        <div className="text-sm text-slate-500 mt-1">Your personal finances — this month</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI label="Income" value={fmt(summary.income, cur)} Icon={TrendUp} tone="success" testId="personal-kpi-income" />
        <KPI label="Expenses" value={fmt(summary.expense, cur)} Icon={TrendDown} tone="danger" testId="personal-kpi-expenses" />
        <KPI label="Net" value={fmt(summary.net, cur)} Icon={ArrowsDownUp} tone={summary.net >= 0 ? "success" : "danger"} testId="personal-kpi-net" />
      </div>
    </div>
  );
}
