import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmt, fmtDate, formatApiError } from "@/lib/utils_app";
import { Plus, DotsThreeVertical, PencilSimple, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

// Ground-truth categories - must match what personal_budgets/personal_bills
// use so budget spend-vs-limit computes correctly (see pulse/src/lib/categories.js,
// same list, established after discovering an earlier mismatch on Pulse).
const CATS_INCOME = ["Salary", "Freelance", "Gifts", "Refunds"];
const CATS_EXPENSE = ["Groceries", "Rent/Mortgage", "Utilities", "Subscriptions", "Dining", "Transportation", "Healthcare", "Entertainment", "Shopping", "Bills"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function PersonalTransactionsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [bills, setBills] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const emptyForm = { type: "income", amount: "", category: CATS_INCOME[0], description: "", date: new Date().toISOString().slice(0, 10), currency: user?.currency || "USD", bill_id: null };
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState("all");
  const [filterYear, setFilterYear] = useState("all");

  // t.date is a plain "YYYY-MM-DD" string - pulling year/month via
  // `new Date(t.date).getFullYear()` round-trips through UTC-midnight
  // parsing + local-timezone reading, which silently shifts dates near a
  // year/month boundary backward by a day for anyone west of UTC (e.g. a
  // 2026-01-01 transaction would report as December 2025). Slicing the
  // string directly sidesteps timezone conversion entirely.
  const availableYears = useMemo(
    () => Array.from(new Set(items.map((t) => Number(t.date?.slice(0, 4))))).sort((a, b) => b - a),
    [items],
  );

  const filteredItems = useMemo(() => {
    let result = items;
    if (filterYear !== "all") result = result.filter((t) => t.date?.slice(0, 4) === filterYear);
    if (filterMonth !== "all") result = result.filter((t) => String(Number(t.date?.slice(5, 7)) - 1) === filterMonth);
    return result;
  }, [items, filterMonth, filterYear]);

  const load = async () => {
    const { data } = await api.get("/personal/transactions");
    setItems(data);
    setLoading(false);
  };
  useEffect(() => {
    load();
    api.get("/personal/bills").then(({ data }) => setBills(data));
  }, []);

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (t) => {
    setEditing(t);
    setForm({ ...t, amount: String(t.amount) });
    setOpen(true);
  };

  const pickBill = (billId) => {
    if (billId === "__none__") { setForm((prev) => ({ ...prev, bill_id: null })); return; }
    const b = bills.find((x) => x.id === billId);
    if (!b) return;
    setForm((prev) => ({ ...prev, bill_id: b.id, category: b.category }));
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = { ...form, amount: parseFloat(form.amount || 0) };
    try {
      if (editing) await api.put(`/personal/transactions/${editing.id}`, payload);
      else await api.post("/personal/transactions", payload);
      toast.success(editing ? "Transaction updated" : "Transaction added");
      setOpen(false);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const [pendingRemove, setPendingRemove] = useState(null);
  const confirmRemove = async () => {
    const t = pendingRemove;
    setPendingRemove(null);
    await api.delete(`/personal/transactions/${t.id}`);
    toast.success("Deleted");
    load();
  };

  const cats = form.type === "income" ? CATS_INCOME : CATS_EXPENSE;

  return (
    <div className="p-8 space-y-6" data-testid="personal-transactions-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Personal</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Transactions</h1>
          <div className="text-sm text-slate-500 mt-1">Your income and spending</div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} data-testid="add-personal-transaction-button">
              <Plus size={16} className="mr-2" /> New transaction
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} transaction</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm((prev) => ({ ...prev, type: v, category: v === "income" ? CATS_INCOME[0] : CATS_EXPENSE[0], bill_id: v === "income" ? null : prev.bill_id }))}>
                    <SelectTrigger data-testid="ptx-type-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="income">Income</SelectItem>
                      <SelectItem value="expense">Expense</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required data-testid="ptx-date-input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Amount</Label>
                  <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required data-testid="ptx-amount-input" />
                </div>
                <div>
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger data-testid="ptx-category-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.type === "expense" && bills.length > 0 && (
                <div>
                  <Label>Pay a bill (optional)</Label>
                  <Select value={form.bill_id || "__none__"} onValueChange={pickBill}>
                    <SelectTrigger data-testid="ptx-bill-select"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {bills.map((b) => <SelectItem key={b.id} value={b.id}>{b.name} · {fmt(b.amount, b.currency)} · due {fmtDate(b.due_date)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Description</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="ptx-description-input" />
              </div>
              <DialogFooter>
                <Button type="submit" data-testid="ptx-submit-button">{editing ? "Update" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider mr-1">Filter</span>
        <Select value={filterMonth} onValueChange={setFilterMonth}>
          <SelectTrigger className="w-[150px] h-9" data-testid="ptx-filter-month">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All months</SelectItem>
            {MONTHS.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterYear} onValueChange={setFilterYear}>
          <SelectTrigger className="w-[120px] h-9" data-testid="ptx-filter-year">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {availableYears.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        {(filterMonth !== "all" || filterYear !== "all") && (
          <button onClick={() => { setFilterMonth("all"); setFilterYear("all"); }} className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline underline-offset-2">
            Clear
          </button>
        )}
      </div>

      <Card className="border-slate-200 shadow-none overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-8">Loading...</TableCell></TableRow>
            ) : filteredItems.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-10" data-testid="ptx-empty">{filterMonth !== "all" || filterYear !== "all" ? "No transactions match the selected filters." : "No transactions yet. Add your first entry."}</TableCell></TableRow>
            ) : filteredItems.map((t) => (
              <TableRow key={t.id} data-testid={`ptx-row-${t.id}`}>
                <TableCell className="text-sm text-slate-600">{fmtDate(t.date)}</TableCell>
                <TableCell>
                  <span className={`text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded ${t.type === "income" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>{t.type}</span>
                </TableCell>
                <TableCell>{t.category}</TableCell>
                <TableCell className="text-sm text-slate-600 max-w-xs truncate">{t.description}</TableCell>
                <TableCell className={`text-right font-semibold ${t.type === "income" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                  {t.type === "income" ? "+" : "-"}{fmt(t.amount, t.currency)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 hover:bg-slate-100 rounded" data-testid={`ptx-menu-${t.id}`}><DotsThreeVertical size={18} /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => openEdit(t)}><PencilSimple size={14} className="mr-2" /> Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPendingRemove(t)} className="text-red-600"><Trash size={14} className="mr-2" /> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title="Delete this transaction?"
        onConfirm={confirmRemove}
      />
    </div>
  );
}
