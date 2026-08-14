import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fmt, formatApiError } from "@/lib/utils_app";
import { Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

// Same thresholds as pulse/src/lib/format.js's budgetRatio/budgetBarColor -
// red at/over the limit, amber >=75%, green under.
function ratio(spent, limit) {
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(1, spent / limit));
}
function barColor(spent, limit) {
  if (limit <= 0) return "bg-slate-300";
  const r = spent / limit;
  if (r >= 1) return "bg-red-600";
  if (r >= 0.75) return "bg-amber-500";
  return "bg-emerald-600";
}

export default function PersonalBudgetsPage() {
  const [budgets, setBudgets] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);

  const load = () => api.get("/personal/budgets/summary").then(({ data }) => setBudgets(data));
  useEffect(() => { load(); }, []);

  const confirmRemove = async () => {
    const b = pendingRemove;
    setPendingRemove(null);
    try {
      await api.delete(`/personal/budgets/${b.id}`);
      toast.success("Budget deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="p-8 space-y-6" data-testid="personal-budgets-page">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Personal</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Budgets</h1>
        <div className="text-sm text-slate-500 mt-1">Where you stand against this month's limits</div>
      </div>

      {budgets === null ? (
        <div className="text-slate-500" data-testid="personal-budgets-loading">Loading...</div>
      ) : budgets.length === 0 ? (
        <div className="text-slate-500" data-testid="personal-budgets-empty">No budgets set yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {budgets.map((b) => (
            <Card key={b.id} className="p-5 border-slate-200 shadow-none" data-testid={`budget-card-${b.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>{b.category}</div>
                  <div className="text-sm text-slate-500 mt-0.5">{fmt(b.spent, b.currency)} of {fmt(b.monthly_limit, b.currency)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingRemove(b)}
                  className="h-8 w-8 shrink-0 grid place-items-center rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Delete budget"
                  data-testid={`budget-delete-${b.id}`}
                >
                  <Trash size={16} />
                </button>
              </div>
              <div className="mt-4 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${barColor(b.spent, b.monthly_limit)}`} style={{ width: `${ratio(b.spent, b.monthly_limit) * 100}%` }} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title={`Delete the ${pendingRemove?.category} budget?`}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
