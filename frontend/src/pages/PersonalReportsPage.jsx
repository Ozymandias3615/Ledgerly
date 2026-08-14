import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fmt, fmtDate, exportAndDownload, loadPersisted, savePersisted } from "@/lib/utils_app";
import { Play, Download } from "@phosphor-icons/react";
import { toast } from "sonner";

// Same ground-truth lists as PersonalTransactionsPage.jsx/PersonalBudgetsPage.jsx.
const CATS_INCOME = ["Salary", "Freelance", "Gifts", "Refunds"];
const CATS_EXPENSE = ["Groceries", "Rent/Mortgage", "Utilities", "Subscriptions", "Dining", "Transportation", "Healthcare", "Entertainment", "Shopping", "Bills"];

const firstDayOfYear = () => `${new Date().getFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);
const REPORTS_RANGE_KEY = "ledgerly:personal-reports:range";

// A budget's monthly_limit is a single ongoing value, not versioned per
// month - comparing a multi-month report range against it means scaling
// by how many calendar months the range actually touches.
function monthsInRange(start, end) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (e < s) return 0;
  let count = 0;
  let cur = new Date(s.getFullYear(), s.getMonth(), 1);
  const last = new Date(e.getFullYear(), e.getMonth(), 1);
  while (cur <= last) {
    count++;
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return count;
}

export default function PersonalReportsPage() {
  const { user } = useAuth();
  const cur = user?.currency || "USD";
  const [range, setRange] = useState(() => loadPersisted(REPORTS_RANGE_KEY, { start: firstDayOfYear(), end: today() }));
  const [scope, setScope] = useState("all"); // "all" | "category" | "budget"
  const [selectedCategory, setSelectedCategory] = useState(CATS_EXPENSE[0]);
  const [budgets, setBudgets] = useState([]);
  const [selectedBudgetId, setSelectedBudgetId] = useState("");
  const [pnl, setPnl] = useState(null);
  const [categoryReport, setCategoryReport] = useState(null);
  const [loading, setLoading] = useState(false);

  // Remembers the last-chosen date range so returning to Reports restores it
  // instead of resetting to the year-to-date default.
  useEffect(() => { savePersisted(REPORTS_RANGE_KEY, range); }, [range]);

  useEffect(() => {
    api.get("/personal/budgets/summary").then(({ data }) => setBudgets(data));
  }, []);
  useEffect(() => {
    if (budgets.length > 0 && !selectedBudgetId) setSelectedBudgetId(budgets[0].id);
  }, [budgets, selectedBudgetId]);

  const run = async () => {
    setLoading(true);
    try {
      if (scope === "all") {
        const { data } = await api.get("/personal/reports/pnl", { params: range });
        setPnl(data);
      } else {
        const budget = scope === "budget" ? budgets.find((b) => b.id === selectedBudgetId) : null;
        const category = scope === "budget" ? budget?.category : selectedCategory;
        if (!category) { toast.error("Pick a budget first"); return; }
        const { data } = await api.get("/personal/transactions", {
          params: { category, date_from: range.start, date_to: range.end },
        });
        const total = data.reduce((s, t) => s + Number(t.amount || 0), 0);
        const months = monthsInRange(range.start, range.end);
        setCategoryReport({
          category,
          isIncome: CATS_INCOME.includes(category),
          total,
          transactions: data,
          months,
          budgetId: budget ? budget.id : null,
          budgetLimit: budget ? budget.monthly_limit : null,
          periodLimit: budget ? budget.monthly_limit * months : null,
        });
      }
    } catch (e) { toast.error("Failed to load report"); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, []);

  // Export always asks for a filename first rather than downloading
  // immediately - openExportPrompt just stages the format/kind and seeds a
  // sensible default; the actual request only fires once the user confirms
  // in the dialog below.
  const [exportPrompt, setExportPrompt] = useState(null); // { kind: "pnl" | "category", format }
  const [exportFilename, setExportFilename] = useState("");

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  const openExportPrompt = (kind, format) => {
    const defaultName = kind === "pnl"
      ? `income_expenses_${range.start}_to_${range.end}`
      : `${slug(categoryReport.category)}_report_${range.start}_to_${range.end}`;
    setExportPrompt({ kind, format });
    setExportFilename(defaultName);
  };

  const confirmExport = () => {
    const { kind, format } = exportPrompt;
    const name = exportFilename.trim() || "export";
    const filename = `${name}.${format}`;
    setExportPrompt(null);
    if (kind === "pnl") {
      exportAndDownload(
        async () => (await api.get("/personal/export/pnl", { params: { format, ...range }, responseType: "blob" })).data,
        filename,
      );
    } else {
      exportAndDownload(
        async () => (await api.get("/personal/export/category", {
          params: { format, category: categoryReport.category, start: range.start, end: range.end, budget_id: categoryReport.budgetId || undefined },
          responseType: "blob",
        })).data,
        filename,
      );
    }
  };

  return (
    <div className="p-8 space-y-6" data-testid="personal-reports-page">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Personal</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Reports</h1>
        <div className="text-sm text-slate-500 mt-1">Income & expenses for any period, category, or budget</div>
      </div>

      <Card className="p-4 border-slate-200 shadow-none flex flex-wrap items-end gap-4">
        <div><Label>From</Label><Input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} data-testid="personal-report-start-input" /></div>
        <div><Label>To</Label><Input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} data-testid="personal-report-end-input" /></div>
        <div>
          <Label>Report</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-[160px]" data-testid="personal-report-scope"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="category">By category</SelectItem>
              <SelectItem value="budget">By budget</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {scope === "category" && (
          <div>
            <Label>Category</Label>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[170px]" data-testid="personal-report-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATS_INCOME.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                {CATS_EXPENSE.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {scope === "budget" && (
          <div>
            <Label>Budget</Label>
            <Select value={selectedBudgetId} onValueChange={setSelectedBudgetId} disabled={budgets.length === 0}>
              <SelectTrigger className="w-[200px]" data-testid="personal-report-budget"><SelectValue placeholder={budgets.length === 0 ? "No budgets yet" : "Select..."} /></SelectTrigger>
              <SelectContent>
                {budgets.map((b) => <SelectItem key={b.id} value={b.id}>{b.category}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button onClick={run} disabled={loading || (scope === "budget" && !selectedBudgetId)} data-testid="run-personal-report-button"><Play size={16} className="mr-2" /> {loading ? "Running..." : "Run report"}</Button>
      </Card>

      {scope === "all" ? (
        <Card className="p-6 border-slate-200 shadow-none max-w-2xl" data-testid="personal-pnl-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Income & Expenses</div>
              <div className="font-bold text-lg mb-4" style={{ fontFamily: "Manrope, sans-serif" }}>{fmtDate(range.start)} → {fmtDate(range.end)}</div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!pnl} data-testid="export-personal-pnl-button"><Download size={14} className="mr-2" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => openExportPrompt("pnl", "csv")} data-testid="export-personal-pnl-csv">Export CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => openExportPrompt("pnl", "xlsx")} data-testid="export-personal-pnl-xlsx">Export XLSX</DropdownMenuItem>
                <DropdownMenuItem onClick={() => openExportPrompt("pnl", "pdf")} data-testid="export-personal-pnl-pdf">Export PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {pnl ? (
            <div className="space-y-6">
              <div>
                <div className="text-xs uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-2">Income</div>
                <Table>
                  <TableBody>
                    {pnl.income.length === 0 ? (<TableRow><TableCell className="text-slate-500">No income in period</TableCell></TableRow>) : pnl.income.map((r) => (
                      <TableRow key={r.category}><TableCell>{r.category}</TableCell><TableCell className="text-right font-semibold">{fmt(r.amount, cur)}</TableCell></TableRow>
                    ))}
                    <TableRow><TableCell className="font-bold">Total income</TableCell><TableCell className="text-right font-bold" data-testid="personal-pnl-total-income">{fmt(pnl.total_income, cur)}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </div>
              <div>
                <div className="text-xs uppercase tracking-widest text-red-700 dark:text-red-400 mb-2">Expenses</div>
                <Table>
                  <TableBody>
                    {pnl.expenses.length === 0 ? (<TableRow><TableCell className="text-slate-500">No expenses in period</TableCell></TableRow>) : pnl.expenses.map((r) => (
                      <TableRow key={r.category}><TableCell>{r.category}</TableCell><TableCell className="text-right font-semibold">{fmt(r.amount, cur)}</TableCell></TableRow>
                    ))}
                    <TableRow><TableCell className="font-bold">Total expenses</TableCell><TableCell className="text-right font-bold" data-testid="personal-pnl-total-expense">{fmt(pnl.total_expense, cur)}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </div>
              <div className="border-t-2 border-slate-900 pt-3 flex justify-between text-xl font-extrabold" style={{ fontFamily: "Manrope, sans-serif" }}>
                <span>Net</span>
                <span className={pnl.net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"} data-testid="personal-pnl-net">{fmt(pnl.net, cur)}</span>
              </div>
            </div>
          ) : <div className="text-slate-500">Run report to generate.</div>}
        </Card>
      ) : (
        <Card className="p-6 border-slate-200 shadow-none max-w-2xl" data-testid="personal-category-report-card">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{scope === "budget" ? "Budget report" : "Category report"}</div>
              <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>{categoryReport?.category || (scope === "budget" ? "Pick a budget" : selectedCategory)}</div>
              <div className="text-sm text-slate-500">{fmtDate(range.start)} → {fmtDate(range.end)}</div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!categoryReport} data-testid="export-category-report-button"><Download size={14} className="mr-2" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => openExportPrompt("category", "csv")} data-testid="export-category-report-csv">Export CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => openExportPrompt("category", "xlsx")} data-testid="export-category-report-xlsx">Export XLSX</DropdownMenuItem>
                <DropdownMenuItem onClick={() => openExportPrompt("category", "pdf")} data-testid="export-category-report-pdf">Export PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {categoryReport ? (
            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-slate-600">{categoryReport.isIncome ? "Total earned" : "Total spent"}</span>
                <span
                  className={`text-2xl font-extrabold ${categoryReport.isIncome ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
                  style={{ fontFamily: "Manrope, sans-serif" }}
                  data-testid="category-report-total"
                >
                  {fmt(categoryReport.total, cur)}
                </span>
              </div>

              {categoryReport.budgetLimit != null && (
                <div className="rounded-md border border-slate-200 p-3 text-sm space-y-1.5" data-testid="category-report-budget-compare">
                  <div className="flex justify-between"><span className="text-slate-500">Monthly limit</span><span className="font-medium">{fmt(categoryReport.budgetLimit, cur)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Limit over {categoryReport.months} month{categoryReport.months === 1 ? "" : "s"}</span><span className="font-medium">{fmt(categoryReport.periodLimit, cur)}</span></div>
                  <div className="flex justify-between border-t border-slate-100 pt-1.5">
                    <span className="text-slate-500">{categoryReport.total > categoryReport.periodLimit ? "Over by" : "Under by"}</span>
                    <span className={`font-semibold ${categoryReport.total > categoryReport.periodLimit ? "text-red-600" : "text-emerald-600"}`}>
                      {fmt(Math.abs(categoryReport.periodLimit - categoryReport.total), cur)}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">Transactions ({categoryReport.transactions.length})</div>
                {categoryReport.transactions.length === 0 ? (
                  <div className="text-sm text-slate-500 py-4">No transactions in this period.</div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {categoryReport.transactions.map((t) => (
                      <div key={t.id} className="flex items-center justify-between border-b border-slate-100 pb-2" data-testid={`category-report-tx-${t.id}`}>
                        <div>
                          <div className="text-sm font-medium">{t.description || t.category}</div>
                          <div className="text-xs text-slate-400">{fmtDate(t.date)}</div>
                        </div>
                        <div className={`text-sm font-semibold ${t.type === "income" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                          {t.type === "income" ? "+" : "-"}{fmt(t.amount, t.currency || cur)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : <div className="text-slate-500">Run report to generate.</div>}
        </Card>
      )}

      <Dialog open={!!exportPrompt} onOpenChange={(open) => !open && setExportPrompt(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Name your export</DialogTitle></DialogHeader>
          <div>
            <Label>File name</Label>
            <div className="flex items-center gap-2">
              <Input
                value={exportFilename}
                onChange={(e) => setExportFilename(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmExport(); }}
                autoFocus
                data-testid="export-filename-input"
              />
              <span className="text-sm text-slate-500 shrink-0">.{exportPrompt?.format}</span>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={confirmExport} disabled={!exportFilename.trim()} data-testid="confirm-export-button">
              <Download size={16} className="mr-2" /> Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
