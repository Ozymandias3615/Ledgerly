import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fmt, fmtDate, exportAndDownload, loadPersisted, savePersisted } from "@/lib/utils_app";
import { Play, Download } from "@phosphor-icons/react";
import { toast } from "sonner";

const firstDayOfYear = () => `${new Date().getFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);
const REPORTS_RANGE_KEY = "ledgerly:personal-reports:range";

export default function PersonalReportsPage() {
  const { user } = useAuth();
  const cur = user?.currency || "USD";
  const [range, setRange] = useState(() => loadPersisted(REPORTS_RANGE_KEY, { start: firstDayOfYear(), end: today() }));
  const [pnl, setPnl] = useState(null);
  const [loading, setLoading] = useState(false);

  // Remembers the last-chosen date range so returning to Reports restores it
  // instead of resetting to the year-to-date default.
  useEffect(() => { savePersisted(REPORTS_RANGE_KEY, range); }, [range]);

  const run = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/personal/reports/pnl", { params: range });
      setPnl(data);
    } catch (e) { toast.error("Failed to load report"); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, []);

  const exportReport = (format) => exportAndDownload(
    async () => (await api.get("/personal/export/pnl", { params: { format, ...range }, responseType: "blob" })).data,
    `income_expenses.${format}`,
  );

  return (
    <div className="p-8 space-y-6" data-testid="personal-reports-page">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Personal</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Reports</h1>
        <div className="text-sm text-slate-500 mt-1">Income & expenses for any period</div>
      </div>

      <Card className="p-4 border-slate-200 shadow-none flex flex-wrap items-end gap-4">
        <div><Label>From</Label><Input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} data-testid="personal-report-start-input" /></div>
        <div><Label>To</Label><Input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} data-testid="personal-report-end-input" /></div>
        <Button onClick={run} disabled={loading} data-testid="run-personal-report-button"><Play size={16} className="mr-2" /> {loading ? "Running..." : "Run report"}</Button>
      </Card>

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
              <DropdownMenuItem onClick={() => exportReport("csv")} data-testid="export-personal-pnl-csv">Export CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportReport("xlsx")} data-testid="export-personal-pnl-xlsx">Export XLSX</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportReport("pdf")} data-testid="export-personal-pnl-pdf">Export PDF</DropdownMenuItem>
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
    </div>
  );
}
