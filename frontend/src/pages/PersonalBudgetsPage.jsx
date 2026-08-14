import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import AnimatedBar from "@/components/AnimatedBar";
import { fmt, fmtDate, formatApiError } from "@/lib/utils_app";
import { Plus, PencilSimple, Trash, Receipt } from "@phosphor-icons/react";
import { toast } from "sonner";

// Same ground-truth list as PersonalTransactionsPage.jsx's CATS_EXPENSE -
// budget spend-vs-limit only lines up if these match exactly.
const CATS_EXPENSE = ["Groceries", "Rent/Mortgage", "Utilities", "Subscriptions", "Dining", "Transportation", "Healthcare", "Entertainment", "Shopping", "Bills"];

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
  const { user } = useAuth();
  const [budgets, setBudgets] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const emptyForm = { category: CATS_EXPENSE[0], monthly_limit: "", currency: user?.currency || "USD" };
  const [form, setForm] = useState(emptyForm);

  const [logOpen, setLogOpen] = useState(false);
  const [logBudget, setLogBudget] = useState(null);
  const emptyLogForm = { amount: "", description: "", date: new Date().toISOString().slice(0, 10) };
  const [logForm, setLogForm] = useState(emptyLogForm);

  const [detailBudget, setDetailBudget] = useState(null);
  const [detailTransactions, setDetailTransactions] = useState(null);

  const load = () => api.get("/personal/budgets/summary").then(({ data }) => setBudgets(data));
  useEffect(() => { load(); }, []);

  const openDetail = (b) => {
    setDetailBudget(b);
    setDetailTransactions(null);
    // Same month window the backend sums into "spent" (see
    // get_budgets_summary's date range) so this list always matches the
    // number shown on the card.
    const monthKey = new Date().toISOString().slice(0, 7);
    api.get("/personal/transactions", {
      params: { category: b.category, type: "expense", date_from: `${monthKey}-01`, date_to: `${monthKey}-32` },
    }).then(({ data }) => setDetailTransactions(data));
  };

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (b) => {
    setEditing(b);
    setForm({ category: b.category, monthly_limit: String(b.monthly_limit), currency: b.currency });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = { ...form, monthly_limit: parseFloat(form.monthly_limit || 0) };
    try {
      if (editing) await api.put(`/personal/budgets/${editing.id}`, payload);
      else await api.post("/personal/budgets", payload);
      toast.success(editing ? "Budget updated" : "Budget added");
      setOpen(false);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

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

  const openLog = (b) => {
    setLogBudget(b);
    setLogForm(emptyLogForm);
    setLogOpen(true);
  };

  const saveLog = async (e) => {
    e.preventDefault();
    try {
      await api.post("/personal/transactions", {
        type: "expense",
        amount: parseFloat(logForm.amount || 0),
        category: logBudget.category,
        description: logForm.description,
        date: logForm.date,
        currency: logBudget.currency,
      });
      toast.success("Expense logged");
      setLogOpen(false);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="p-8 space-y-6" data-testid="personal-budgets-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Personal</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Budgets</h1>
          <div className="text-sm text-slate-500 mt-1">Where you stand against this month's limits</div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} data-testid="add-personal-budget-button">
              <Plus size={16} className="mr-2" /> New budget
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} budget</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-3">
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })} disabled={!!editing}>
                  <SelectTrigger data-testid="budget-category-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATS_EXPENSE.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Monthly limit</Label>
                <Input type="number" step="0.01" value={form.monthly_limit} onChange={(e) => setForm({ ...form, monthly_limit: e.target.value })} required data-testid="budget-limit-input" />
              </div>
              <DialogFooter>
                <Button type="submit" data-testid="budget-submit-button">{editing ? "Update" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {budgets === null ? (
        <div className="text-slate-500" data-testid="personal-budgets-loading">Loading...</div>
      ) : budgets.length === 0 ? (
        <div className="text-slate-500" data-testid="personal-budgets-empty">No budgets set yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {budgets.map((b) => (
            <Card
              key={b.id}
              className="p-5 border-slate-200 shadow-none cursor-pointer hover:border-slate-300 transition-colors"
              onClick={() => openDetail(b)}
              data-testid={`budget-card-${b.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>{b.category}</div>
                  <div className="text-sm text-slate-500 mt-0.5">{fmt(b.spent, b.currency)} of {fmt(b.monthly_limit, b.currency)}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openLog(b); }}
                    className="h-8 w-8 grid place-items-center rounded-md text-slate-400 hover:text-primary hover:bg-slate-100 transition-colors"
                    title="Log an expense"
                    data-testid={`budget-log-${b.id}`}
                  >
                    <Receipt size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openEdit(b); }}
                    className="h-8 w-8 grid place-items-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    title="Edit budget"
                    data-testid={`budget-edit-${b.id}`}
                  >
                    <PencilSimple size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPendingRemove(b); }}
                    className="h-8 w-8 grid place-items-center rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Delete budget"
                    data-testid={`budget-delete-${b.id}`}
                  >
                    <Trash size={16} />
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <AnimatedBar pct={ratio(b.spent, b.monthly_limit) * 100} colorClass={barColor(b.spent, b.monthly_limit)} className="h-2" />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Log an expense · {logBudget?.category}</DialogTitle></DialogHeader>
          <form onSubmit={saveLog} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount</Label>
                <Input type="number" step="0.01" value={logForm.amount} onChange={(e) => setLogForm({ ...logForm, amount: e.target.value })} required data-testid="budget-log-amount-input" />
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={logForm.date} onChange={(e) => setLogForm({ ...logForm, date: e.target.value })} required data-testid="budget-log-date-input" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={logForm.description} onChange={(e) => setLogForm({ ...logForm, description: e.target.value })} data-testid="budget-log-description-input" />
            </div>
            <DialogFooter>
              <Button type="submit" data-testid="budget-log-submit-button">Add expense</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailBudget} onOpenChange={(open) => !open && setDetailBudget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{detailBudget?.category}</DialogTitle></DialogHeader>
          {detailBudget && (
            <div className="space-y-4">
              <div className="text-sm text-slate-500">
                {fmt(detailBudget.spent, detailBudget.currency)} of {fmt(detailBudget.monthly_limit, detailBudget.currency)} spent this month
              </div>
              <AnimatedBar pct={ratio(detailBudget.spent, detailBudget.monthly_limit) * 100} colorClass={barColor(detailBudget.spent, detailBudget.monthly_limit)} className="h-2" />

              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">Transactions this month</div>
                {detailTransactions === null ? (
                  <div className="text-sm text-slate-500 py-4">Loading...</div>
                ) : detailTransactions.length === 0 ? (
                  <div className="text-sm text-slate-500 py-4">No transactions in this category yet.</div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {detailTransactions.map((t) => (
                      <div key={t.id} className="flex items-center justify-between border-b border-slate-100 pb-2" data-testid={`budget-tx-${t.id}`}>
                        <div>
                          <div className="text-sm font-medium">{t.description || t.category}</div>
                          <div className="text-xs text-slate-400">{fmtDate(t.date)}</div>
                        </div>
                        <div className="text-sm font-semibold text-red-700 dark:text-red-400">-{fmt(t.amount, t.currency)}</div>
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
        title={`Delete the ${pendingRemove?.category} budget?`}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
