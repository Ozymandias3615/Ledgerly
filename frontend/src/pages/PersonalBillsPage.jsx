import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmt, fmtDate, formatApiError } from "@/lib/utils_app";
import { Plus, DotsThreeVertical, PencilSimple, Trash, Check } from "@phosphor-icons/react";
import { toast } from "sonner";

// Same ground-truth list as PersonalTransactionsPage.jsx's CATS_EXPENSE.
const CATS_EXPENSE = ["Groceries", "Rent/Mortgage", "Utilities", "Subscriptions", "Dining", "Transportation", "Healthcare", "Entertainment", "Shopping", "Bills"];

const DUE_SOON_DAYS = 3;

function billStatus(dueDate) {
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return "overdue";
  const soon = new Date();
  soon.setDate(soon.getDate() + DUE_SOON_DAYS);
  if (dueDate <= soon.toISOString().slice(0, 10)) return "due-soon";
  return null;
}

export default function PersonalBillsPage() {
  const { user } = useAuth();
  const [bills, setBills] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [pendingMarkPaid, setPendingMarkPaid] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const emptyForm = { name: "", category: CATS_EXPENSE[0], amount: "", due_date: new Date().toISOString().slice(0, 10), currency: user?.currency || "USD", recurring: true };
  const [form, setForm] = useState(emptyForm);

  const load = () => api.get("/personal/bills").then(({ data }) => setBills(data));
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (b) => {
    setEditing(b);
    setForm({ name: b.name, category: b.category, amount: String(b.amount), due_date: b.due_date, currency: b.currency, recurring: !!b.recurring });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = { ...form, amount: parseFloat(form.amount || 0) };
    try {
      if (editing) await api.put(`/personal/bills/${editing.id}`, payload);
      else await api.post("/personal/bills", payload);
      toast.success(editing ? "Bill updated" : "Bill added");
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
      await api.delete(`/personal/bills/${b.id}`);
      toast.success("Bill deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const confirmMarkPaid = async () => {
    const b = pendingMarkPaid;
    setPendingMarkPaid(null);
    try {
      await api.post(`/personal/bills/${b.id}/mark-paid`);
      toast.success(`${b.name} marked paid`);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="p-8 space-y-6" data-testid="personal-bills-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Personal</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Bills</h1>
          <div className="text-sm text-slate-500 mt-1">Upcoming and recurring bills</div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew} data-testid="add-personal-bill-button">
              <Plus size={16} className="mr-2" /> New bill
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} bill</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="bill-name-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger data-testid="bill-category-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATS_EXPENSE.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Amount</Label>
                  <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required data-testid="bill-amount-input" />
                </div>
              </div>
              <div>
                <Label>Due date</Label>
                <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} required data-testid="bill-due-date-input" />
              </div>
              <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2.5">
                <div>
                  <Label className="mb-0">Recurring</Label>
                  <div className="text-xs text-slate-500">Advances a month forward when marked paid instead of disappearing</div>
                </div>
                <Switch checked={form.recurring} onCheckedChange={(v) => setForm({ ...form, recurring: v })} data-testid="bill-recurring-switch" />
              </div>
              <DialogFooter>
                <Button type="submit" data-testid="bill-submit-button">{editing ? "Update" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-slate-200 shadow-none overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-56"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills === null ? (
              <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-8" data-testid="personal-bills-loading">Loading...</TableCell></TableRow>
            ) : bills.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-10" data-testid="personal-bills-empty">No bills yet.</TableCell></TableRow>
            ) : bills.map((b) => {
              const status = billStatus(b.due_date);
              return (
                <TableRow key={b.id} data-testid={`bill-row-${b.id}`}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell>{b.category}</TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {fmtDate(b.due_date)}
                    {status === "overdue" && <span className="ml-2 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400">Overdue</span>}
                    {status === "due-soon" && <span className="ml-2 text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Due soon</span>}
                  </TableCell>
                  <TableCell className="text-right font-semibold">{fmt(b.amount, b.currency)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPendingMarkPaid(b)} data-testid={`bill-mark-paid-${b.id}`}>
                        <Check size={14} className="mr-1.5" /> Mark paid
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1 hover:bg-slate-100 rounded" data-testid={`bill-menu-${b.id}`}><DotsThreeVertical size={18} /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => openEdit(b)}><PencilSimple size={14} className="mr-2" /> Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setPendingRemove(b)} className="text-red-600"><Trash size={14} className="mr-2" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <ConfirmDialog
        open={!!pendingMarkPaid}
        onOpenChange={(open) => !open && setPendingMarkPaid(null)}
        title={`Mark ${pendingMarkPaid?.name} as paid?`}
        description="This logs an expense and moves the due date forward."
        confirmLabel="Mark paid"
        destructive={false}
        onConfirm={confirmMarkPaid}
      />
      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title={`Delete ${pendingRemove?.name}?`}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
