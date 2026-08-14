import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import Confetti from "@/components/Confetti";
import { fmt, fmtDate, formatApiError } from "@/lib/utils_app";
import { Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

function ratio(current, target) {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, current / target));
}

export default function PersonalGoalsPage() {
  const { user } = useAuth();
  const [goals, setGoals] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [detailGoal, setDetailGoal] = useState(null);
  const [contributions, setContributions] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const emptyForm = { name: "", target_amount: "", target_date: "", currency: user?.currency || "USD" };
  const [form, setForm] = useState(emptyForm);

  const [contribForm, setContribForm] = useState({ amount: "", date: new Date().toISOString().slice(0, 10), note: "" });

  const load = () => api.get("/personal/goals").then(({ data }) => setGoals(data));
  useEffect(() => { load(); }, []);

  const openDetail = (g) => {
    setDetailGoal(g);
    setContributions(null);
    setContribForm({ amount: "", date: new Date().toISOString().slice(0, 10), note: "" });
    api.get(`/personal/goals/${g.id}/contributions`).then(({ data }) => setContributions(data));
  };

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (e, g) => {
    e.stopPropagation();
    setEditing(g);
    setForm({ name: g.name, target_amount: String(g.target_amount), target_date: g.target_date || "", currency: g.currency });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = { ...form, target_amount: parseFloat(form.target_amount || 0), target_date: form.target_date || null };
    try {
      if (editing) await api.put(`/personal/goals/${editing.id}`, payload);
      else await api.post("/personal/goals", payload);
      toast.success(editing ? "Goal updated" : "Goal added");
      setOpen(false);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const confirmRemove = async () => {
    const g = pendingRemove;
    setPendingRemove(null);
    try {
      await api.delete(`/personal/goals/${g.id}`);
      toast.success("Goal deleted");
      if (detailGoal?.id === g.id) setDetailGoal(null);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const addContribution = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post(`/personal/goals/${detailGoal.id}/contributions`, {
        amount: parseFloat(contribForm.amount || 0),
        date: contribForm.date,
        note: contribForm.note,
      });
      toast.success("Contribution added");
      setContribForm({ amount: "", date: new Date().toISOString().slice(0, 10), note: "" });
      setDetailGoal((g) => ({ ...g, current_amount: data.current_amount }));
      api.get(`/personal/goals/${detailGoal.id}/contributions`).then(({ data: rows }) => setContributions(rows));
      load();
      if (data.just_reached) setShowConfetti(true);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="p-8 space-y-6" data-testid="personal-goals-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Personal</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Goals</h1>
          <div className="text-sm text-slate-500 mt-1">Your savings goals and progress</div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} data-testid="add-personal-goal-button">
              <Plus size={16} className="mr-2" /> New goal
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} goal</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="goal-name-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Target amount</Label>
                  <Input type="number" step="0.01" value={form.target_amount} onChange={(e) => setForm({ ...form, target_amount: e.target.value })} required data-testid="goal-target-input" />
                </div>
                <div>
                  <Label>Target date (optional)</Label>
                  <Input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} data-testid="goal-date-input" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" data-testid="goal-submit-button">{editing ? "Update" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => openEdit(e, g)}
                    className="h-8 w-8 grid place-items-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    title="Edit goal"
                    data-testid={`goal-edit-${g.id}`}
                  >
                    <PencilSimple size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPendingRemove(g); }}
                    className="h-8 w-8 grid place-items-center rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Delete goal"
                    data-testid={`goal-delete-${g.id}`}
                  >
                    <Trash size={16} />
                  </button>
                </div>
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

              <form onSubmit={addContribution} className="space-y-2">
                <Label>Add contribution</Label>
                <div className="flex items-end gap-2">
                  <Input type="number" step="0.01" placeholder="Amount" value={contribForm.amount} onChange={(e) => setContribForm({ ...contribForm, amount: e.target.value })} required data-testid="goal-contribution-amount-input" />
                  <Input type="date" className="w-36" value={contribForm.date} onChange={(e) => setContribForm({ ...contribForm, date: e.target.value })} required data-testid="goal-contribution-date-input" />
                  <Button type="submit" className="shrink-0" data-testid="goal-contribution-submit-button">Add</Button>
                </div>
                <Input placeholder="Note (optional)" value={contribForm.note} onChange={(e) => setContribForm({ ...contribForm, note: e.target.value })} data-testid="goal-contribution-note-input" />
              </form>

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

      {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}
    </div>
  );
}
