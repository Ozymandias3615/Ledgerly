import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CURRENCIES, fmt, fmtDate, downloadBlob } from "@/lib/utils_app";
import { Plus, Download, DotsThreeVertical, PencilSimple, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

const CATS_INCOME = ["Sales", "Services", "Consulting", "Interest", "Refunds", "Other Income"];
const CATS_EXPENSE = ["Rent", "Payroll", "Utilities", "Software", "Marketing", "Travel", "Meals", "Supplies", "Professional Fees", "Taxes", "Other Expense"];

export default function TransactionsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const emptyForm = { type: "income", amount: "", category: CATS_INCOME[0], description: "", date: new Date().toISOString().slice(0, 10), currency: user?.currency || "USD", tax_amount: "" };
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await api.get("/transactions");
    setItems(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (t) => {
    setEditing(t);
    setForm({ ...t, amount: String(t.amount), tax_amount: String(t.tax_amount || 0) });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = { ...form, amount: parseFloat(form.amount || 0), tax_amount: parseFloat(form.tax_amount || 0) };
    try {
      if (editing) await api.put(`/transactions/${editing.id}`, payload);
      else await api.post("/transactions", payload);
      toast.success(editing ? "Transaction updated" : "Transaction added");
      setOpen(false);
      load();
    } catch (err) {
      toast.error("Failed to save");
    }
  };

  const remove = async (t) => {
    if (!window.confirm("Delete this transaction?")) return;
    await api.delete(`/transactions/${t.id}`);
    toast.success("Deleted");
    load();
  };

  const exportFile = async (format) => {
    const r = await api.get(`/export/transactions?format=${format}`, { responseType: "blob" });
    downloadBlob(r.data, `transactions.${format}`);
  };

  const cats = form.type === "income" ? CATS_INCOME : CATS_EXPENSE;

  return (
    <div className="p-8 space-y-6" data-testid="transactions-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Bookkeeping</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Transactions</h1>
          <div className="text-sm text-slate-500 mt-1">Daily cash flow and journal entries</div>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="export-transactions-button"><Download size={16} className="mr-2" /> Export</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => exportFile("csv")} data-testid="export-csv">Export CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportFile("xlsx")} data-testid="export-xlsx">Export XLSX</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportFile("pdf")} data-testid="export-pdf">Export PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} className="bg-slate-900 hover:bg-slate-800" data-testid="add-transaction-button">
                <Plus size={16} className="mr-2" /> New transaction
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} transaction</DialogTitle></DialogHeader>
              <form onSubmit={save} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v, category: v === "income" ? CATS_INCOME[0] : CATS_EXPENSE[0] })}>
                      <SelectTrigger data-testid="tx-type-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="income">Income</SelectItem>
                        <SelectItem value="expense">Expense</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Date</Label>
                    <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required data-testid="tx-date-input" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Amount</Label>
                    <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required data-testid="tx-amount-input" />
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                      <SelectTrigger data-testid="tx-currency-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger data-testid="tx-category-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tax amount</Label>
                  <Input type="number" step="0.01" value={form.tax_amount} onChange={(e) => setForm({ ...form, tax_amount: e.target.value })} data-testid="tx-tax-input" />
                </div>
                <div>
                  <Label>Description</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="tx-description-input" />
                </div>
                <DialogFooter>
                  <Button type="submit" className="bg-slate-900 hover:bg-slate-800" data-testid="tx-submit-button">{editing ? "Update" : "Add"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="border-slate-200 shadow-none overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-8">Loading...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-10" data-testid="tx-empty">No transactions yet. Add your first entry.</TableCell></TableRow>
            ) : items.map((t) => (
              <TableRow key={t.id} data-testid={`tx-row-${t.id}`}>
                <TableCell className="text-sm text-slate-600">{fmtDate(t.date)}</TableCell>
                <TableCell>
                  <span className={`text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded ${t.type === "income" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{t.type}</span>
                </TableCell>
                <TableCell>{t.category}</TableCell>
                <TableCell className="text-sm text-slate-600 max-w-xs truncate">{t.description}</TableCell>
                <TableCell className="text-right text-sm text-slate-600">{fmt(t.tax_amount || 0, t.currency)}</TableCell>
                <TableCell className={`text-right font-semibold ${t.type === "income" ? "text-emerald-700" : "text-red-700"}`}>
                  {t.type === "income" ? "+" : "-"}{fmt(t.amount, t.currency)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 hover:bg-slate-100 rounded" data-testid={`tx-menu-${t.id}`}><DotsThreeVertical size={18} /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => openEdit(t)}><PencilSimple size={14} className="mr-2" /> Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => remove(t)} className="text-red-600"><Trash size={14} className="mr-2" /> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
