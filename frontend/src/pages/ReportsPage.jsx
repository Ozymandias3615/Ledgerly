import React, { useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fmt, fmtDate, exportAndDownload, loadPersisted, savePersisted } from "@/lib/utils_app";
import { Play, Download } from "@phosphor-icons/react";
import { toast } from "sonner";

const firstDayOfYear = () => `${new Date().getFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);
const REPORTS_RANGE_KEY = "ledgerly:reports:range";

export default function ReportsPage() {
  const { user } = useAuth();
  const cur = user?.currency || "USD";
  const [range, setRange] = useState(() => loadPersisted(REPORTS_RANGE_KEY, { start: firstDayOfYear(), end: today() }));
  const [pnl, setPnl] = useState(null);
  const [tax, setTax] = useState(null);
  const [loading, setLoading] = useState(false);

  // Remembers the last-chosen date range so returning to Reports restores it
  // instead of resetting to the year-to-date default.
  React.useEffect(() => { savePersisted(REPORTS_RANGE_KEY, range); }, [range]);

  const run = async () => {
    setLoading(true);
    try {
      const [p, t] = await Promise.all([
        api.get(`/reports/pnl`, { params: range }),
        api.get(`/reports/tax`, { params: range }),
      ]);
      setPnl(p.data); setTax(t.data);
    } catch (e) { toast.error("Failed to load reports"); }
    finally { setLoading(false); }
  };

  React.useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  const exportReport = (kind, format) => exportAndDownload(
    async () => (await api.get(`/export/${kind}`, { params: { format, ...range }, responseType: "blob" })).data,
    `${kind}.${format}`,
  );

  return (
    <div className="p-8 space-y-6" data-testid="reports-page">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Statements</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Financial reports</h1>
        <div className="text-sm text-slate-500 mt-1">Profit & Loss and tax summary for any period</div>
      </div>

      <Card className="p-4 border-slate-200 shadow-none flex flex-wrap items-end gap-4">
        <div><Label>From</Label><Input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} data-testid="report-start-input" /></div>
        <div><Label>To</Label><Input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} data-testid="report-end-input" /></div>
        <Button onClick={run} className="bg-slate-900 hover:bg-slate-800" disabled={loading} data-testid="run-report-button"><Play size={16} className="mr-2" /> {loading ? "Running..." : "Run reports"}</Button>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6 border-slate-200 shadow-none" data-testid="pnl-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Profit & Loss</div>
              <div className="font-bold text-lg mb-4" style={{ fontFamily: "Manrope, sans-serif" }}>{fmtDate(range.start)} → {fmtDate(range.end)}</div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!pnl} data-testid="export-pnl-button"><Download size={14} className="mr-2" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => exportReport("pnl", "csv")} data-testid="export-pnl-csv">Export CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportReport("pnl", "xlsx")} data-testid="export-pnl-xlsx">Export XLSX</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportReport("pnl", "pdf")} data-testid="export-pnl-pdf">Export PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {pnl ? (
            <div className="space-y-6">
              <div>
                <div className="text-xs uppercase tracking-widest text-emerald-700 mb-2">Income</div>
                <Table>
                  <TableBody>
                    {pnl.income.length === 0 ? (<TableRow><TableCell className="text-slate-500">No income in period</TableCell></TableRow>) : pnl.income.map((r) => (
                      <TableRow key={r.category}><TableCell>{r.category}</TableCell><TableCell className="text-right font-semibold">{fmt(r.amount, cur)}</TableCell></TableRow>
                    ))}
                    <TableRow><TableCell className="font-bold">Total income</TableCell><TableCell className="text-right font-bold" data-testid="pnl-total-income">{fmt(pnl.total_income, cur)}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </div>
              <div>
                <div className="text-xs uppercase tracking-widest text-red-700 mb-2">Expenses</div>
                <Table>
                  <TableBody>
                    {pnl.expenses.length === 0 ? (<TableRow><TableCell className="text-slate-500">No expenses in period</TableCell></TableRow>) : pnl.expenses.map((r) => (
                      <TableRow key={r.category}><TableCell>{r.category}</TableCell><TableCell className="text-right font-semibold">{fmt(r.amount, cur)}</TableCell></TableRow>
                    ))}
                    <TableRow><TableCell className="font-bold">Total expenses</TableCell><TableCell className="text-right font-bold" data-testid="pnl-total-expense">{fmt(pnl.total_expense, cur)}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </div>
              <div className="border-t-2 border-slate-900 pt-3 flex justify-between text-xl font-extrabold" style={{ fontFamily: "Manrope, sans-serif" }}>
                <span>Net profit</span>
                <span className={pnl.net >= 0 ? "text-emerald-700" : "text-red-700"} data-testid="pnl-net">{fmt(pnl.net, cur)}</span>
              </div>
            </div>
          ) : <div className="text-slate-500">Run report to generate.</div>}
        </Card>

        <Card className="p-6 border-slate-200 shadow-none" data-testid="tax-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Tax summary</div>
              <div className="font-bold text-lg mb-4" style={{ fontFamily: "Manrope, sans-serif" }}>{fmtDate(range.start)} → {fmtDate(range.end)}</div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!tax} data-testid="export-tax-button"><Download size={14} className="mr-2" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => exportReport("tax", "csv")} data-testid="export-tax-csv">Export CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportReport("tax", "xlsx")} data-testid="export-tax-xlsx">Export XLSX</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportReport("tax", "pdf")} data-testid="export-tax-pdf">Export PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {tax ? (
            <div className="space-y-3">
              <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-sm text-slate-600">Tax collected (on income)</span><span className="font-semibold" data-testid="tax-collected-val">{fmt(tax.tax_collected, cur)}</span></div>
              <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-sm text-slate-600">Tax paid (on expenses)</span><span className="font-semibold">{fmt(tax.tax_paid, cur)}</span></div>
              <div className="flex justify-between pt-2 text-lg font-bold border-t border-slate-900" style={{ fontFamily: "Manrope, sans-serif" }}><span>Net liability</span><span data-testid="tax-net">{fmt(tax.net_tax_liability, cur)}</span></div>
            </div>
          ) : <div className="text-slate-500">Run report to generate.</div>}
        </Card>
      </div>
    </div>
  );
}
