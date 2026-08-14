import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmt, fmtDate, formatApiError } from "@/lib/utils_app";
import { Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

function ratio(current, target) {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, current / target));
}

export default function PersonalGoalsPage() {
  const [goals, setGoals] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [detailGoal, setDetailGoal] = useState(null);
  const [contributions, setContributions] = useState(null);

  const load = () => api.get("/personal/goals").then(({ data }) => setGoals(data));
  useEffect(() => { load(); }, []);

  const openDetail = (g) => {
    setDetailGoal(g);
    setContributions(null);
    api.get(`/personal/goals/${g.id}/contributions`).then(({ data }) => setContributions(data));
  };

  const confirmRemove = async () => {
    const g = pendingRemove;
    setPendingRemove(null);
    try {
      await api.delete(`/personal/goals/${g.id}`);
      toast.success("Goal deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="p-8 space-y-6" data-testid="personal-goals-page">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Personal</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Goals</h1>
        <div className="text-sm text-slate-500 mt-1">Your savings goals and progress</div>
      </div>

      {goals === null ? (
        <div className="text-slate-500" data-testid="personal-goals-loading">Loading...</div>
      ) : goals.length === 0 ? (
        <div className="text-slate-500" data-testid="personal-goals-empty">No savings goals yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((g) => (
            <Card
              key={g.id}
              className="p-5 border-slate-200 shadow-none cursor-pointer hover:border-slate-300 transition-colors"
              onClick={() => openDetail(g)}
              data-testid={`goal-card-${g.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>{g.name}</div>
                  <div className="text-sm text-slate-500 mt-0.5">
                    {fmt(g.current_amount, g.currency)} of {fmt(g.target_amount, g.currency)}
                    {g.target_date ? ` · by ${fmtDate(g.target_date)}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPendingRemove(g); }}
                  className="h-8 w-8 shrink-0 grid place-items-center rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Delete goal"
                  data-testid={`goal-delete-${g.id}`}
                >
                  <Trash size={16} />
                </button>
              </div>
              <div className="mt-4 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-500 ease-out" style={{ width: `${ratio(g.current_amount, g.target_amount) * 100}%` }} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!detailGoal} onOpenChange={(open) => !open && setDetailGoal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{detailGoal?.name}</DialogTitle></DialogHeader>
          {detailGoal && (
            <div className="space-y-4">
              <div className="text-sm text-slate-500">
                {fmt(detailGoal.current_amount, detailGoal.currency)} of {fmt(detailGoal.target_amount, detailGoal.currency)}
                {detailGoal.target_date ? ` · target ${fmtDate(detailGoal.target_date)}` : ""}
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${ratio(detailGoal.current_amount, detailGoal.target_amount) * 100}%` }} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">History</div>
                {contributions === null ? (
                  <div className="text-sm text-slate-500 py-4">Loading...</div>
                ) : contributions.length === 0 ? (
                  <div className="text-sm text-slate-500 py-4">No contributions logged yet.</div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {contributions.map((c) => (
                      <div key={c.id} className="flex items-center justify-between border-b border-slate-100 pb-2" data-testid={`contribution-${c.id}`}>
                        <div>
                          <div className="text-sm font-medium">{c.note || "Contribution"}</div>
                          <div className="text-xs text-slate-400">{fmtDate(c.date)}</div>
                        </div>
                        <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">+{fmt(c.amount, detailGoal.currency)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title={`Delete ${pendingRemove?.name}?`}
        description="This removes its contribution history too and can't be undone."
        onConfirm={confirmRemove}
      />
    </div>
  );
}
