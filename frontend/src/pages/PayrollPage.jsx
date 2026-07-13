import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CURRENCIES, fmt, fmtDate, exportAndDownload } from "@/lib/utils_app";
import { Plus, Download, Trash, Play } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function PayrollPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [runs, setRuns] = useState([]);
  const [openEmp, setOpenEmp] = useState(false);
  const [openRun, setOpenRun] = useState(false);
  const [emp, setEmp] = useState({ name: "", email: "", position: "", salary: "", pay_frequency: "monthly", tax_rate: 0, currency: user?.currency || "USD" });
  const [runForm, setRunForm] = useState({ period_start: new Date().toISOString().slice(0, 10), period_end: new Date().toISOString().slice(0, 10) });
  const [selectedEmpIds, setSelectedEmpIds] = useState([]);

  const load = async () => {
    const [e, r] = await Promise.all([api.get("/employees"), api.get("/payroll")]);
    setEmployees(e.data); setRuns(r.data);
  };
  useEffect(() => { if (user?.role !== "staff") load(); }, [user?.role]);

  const addEmp = async (e) => {
    e.preventDefault();
    await api.post("/employees", { ...emp, salary: Number(emp.salary), tax_rate: Number(emp.tax_rate) });
    toast.success("Employee added"); setOpenEmp(false);
    setEmp({ name: "", email: "", position: "", salary: "", pay_frequency: "monthly", tax_rate: 0, currency: user?.currency || "USD" });
    load();
  };

  const removeEmp = async (e) => {
    if (!window.confirm(`Remove ${e.name}?`)) return;
    await api.delete(`/employees/${e.id}`); load();
  };

  const openRunDialog = (open) => {
    if (open) setSelectedEmpIds(employees.map((e) => e.id));
    setOpenRun(open);
  };

  const toggleEmp = (id, checked) => {
    setSelectedEmpIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const toggleAll = (checked) => {
    setSelectedEmpIds(checked ? employees.map((e) => e.id) : []);
  };

  const selectedEmployees = employees.filter((e) => selectedEmpIds.includes(e.id));
  const allSelected = employees.length > 0 && selectedEmpIds.length === employees.length;

  const runPayroll = async (e) => {
    e.preventDefault();
    try {
      await api.post("/payroll/run", { ...runForm, employee_ids: selectedEmpIds });
      toast.success(selectedEmpIds.length === employees.length ? "Payroll processed for all employees" : `Payroll processed for ${selectedEmpIds.length} employee${selectedEmpIds.length === 1 ? "" : "s"}`);
      setOpenRun(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  const exportPayroll = (format) => exportAndDownload(
    async () => (await api.get(`/export/payroll?format=${format}`, { responseType: "blob" })).data,
    `payroll.${format}`,
  );

  if (user?.role === "staff") {
    return (
      <div className="p-8" data-testid="payroll-page">
        <Card className="p-10 text-center border-slate-200 shadow-none max-w-md mx-auto mt-20">
          <div className="text-lg font-semibold text-slate-900 mb-2">Restricted</div>
          <div className="text-sm text-slate-500">You don't have access to payroll. Contact your business owner or admin if you need access.</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6" data-testid="payroll-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">People</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Payroll</h1>
          <div className="text-sm text-slate-500 mt-1">Manage employees and run payroll</div>
        </div>
      </div>

      <Tabs defaultValue="employees">
        <TabsList data-testid="payroll-tabs">
          <TabsTrigger value="employees" data-testid="tab-employees">Employees</TabsTrigger>
          <TabsTrigger value="runs" data-testid="tab-runs">Payroll runs</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Dialog open={openEmp} onOpenChange={setOpenEmp}>
              <DialogTrigger asChild><Button className="bg-slate-900 hover:bg-slate-800" data-testid="add-employee-button"><Plus size={16} className="mr-2" /> Add employee</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New employee</DialogTitle></DialogHeader>
                <form onSubmit={addEmp} className="space-y-3">
                  <div><Label>Name</Label><Input required value={emp.name} onChange={(e) => setEmp({ ...emp, name: e.target.value })} data-testid="emp-name-input" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Email</Label><Input type="email" value={emp.email} onChange={(e) => setEmp({ ...emp, email: e.target.value })} /></div>
                    <div><Label>Position</Label><Input value={emp.position} onChange={(e) => setEmp({ ...emp, position: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Salary</Label><Input type="number" step="0.01" required value={emp.salary} onChange={(e) => setEmp({ ...emp, salary: e.target.value })} data-testid="emp-salary-input" /></div>
                    <div><Label>Tax rate (%)</Label><Input type="number" step="0.01" value={emp.tax_rate} onChange={(e) => setEmp({ ...emp, tax_rate: e.target.value })} /></div>
                    <div><Label>Currency</Label><Select value={emp.currency} onValueChange={(v) => setEmp({ ...emp, currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div><Label>Pay frequency</Label><Select value={emp.pay_frequency} onValueChange={(v) => setEmp({ ...emp, pay_frequency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="biweekly">Bi-weekly</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent></Select></div>
                  <DialogFooter><Button type="submit" className="bg-slate-900 hover:bg-slate-800" data-testid="emp-submit-button">Add</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="border-slate-200 shadow-none overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Position</TableHead><TableHead>Frequency</TableHead><TableHead className="text-right">Salary</TableHead><TableHead className="text-right">Tax %</TableHead><TableHead className="w-16"></TableHead></TableRow></TableHeader>
              <TableBody>
                {employees.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-10">No employees.</TableCell></TableRow>
                ) : employees.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell><div className="font-semibold">{e.name}</div><div className="text-xs text-slate-500">{e.email}</div></TableCell>
                    <TableCell>{e.position}</TableCell>
                    <TableCell className="capitalize">{e.pay_frequency}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(e.salary, e.currency)}</TableCell>
                    <TableCell className="text-right">{e.tax_rate}%</TableCell>
                    <TableCell><button className="p-1 hover:bg-slate-100 rounded text-red-600" onClick={() => removeEmp(e)}><Trash size={16} /></button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="mt-6 space-y-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => exportPayroll("csv")} data-testid="payroll-export-csv"><Download size={16} className="mr-2" /> CSV</Button>
            <Button variant="outline" onClick={() => exportPayroll("xlsx")} data-testid="payroll-export-xlsx"><Download size={16} className="mr-2" /> XLSX</Button>
            <Button variant="outline" onClick={() => exportPayroll("pdf")} data-testid="payroll-export-pdf"><Download size={16} className="mr-2" /> PDF</Button>
            <Dialog open={openRun} onOpenChange={openRunDialog}>
              <DialogTrigger asChild><Button className="bg-slate-900 hover:bg-slate-800" disabled={employees.length === 0} data-testid="run-payroll-button"><Play size={16} className="mr-2" /> Run payroll</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Run payroll</DialogTitle></DialogHeader>
                <form onSubmit={runPayroll} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Period start</Label><Input type="date" required value={runForm.period_start} onChange={(e) => setRunForm({ ...runForm, period_start: e.target.value })} data-testid="run-start-input" /></div>
                    <div><Label>Period end</Label><Input type="date" required value={runForm.period_end} onChange={(e) => setRunForm({ ...runForm, period_end: e.target.value })} data-testid="run-end-input" /></div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label>Employees to pay</Label>
                      <button type="button" className="text-xs text-slate-500 underline underline-offset-4 hover:text-slate-700" onClick={() => toggleAll(!allSelected)} data-testid="run-toggle-all-button">
                        {allSelected ? "Deselect all" : "Process all"}
                      </button>
                    </div>
                    <div className="border border-slate-200 rounded-md max-h-52 overflow-y-auto divide-y divide-slate-100">
                      {employees.map((e) => (
                        <label key={e.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50" data-testid={`run-emp-row-${e.id}`}>
                          <Checkbox checked={selectedEmpIds.includes(e.id)} onCheckedChange={(c) => toggleEmp(e.id, c)} data-testid={`run-emp-checkbox-${e.id}`} />
                          <span className="flex-1 text-sm">
                            <span className="font-medium">{e.name}</span>
                            <span className="text-slate-500"> — {e.position || "Employee"}</span>
                          </span>
                          <span className="text-sm text-slate-600">{fmt(e.salary, e.currency)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="text-sm text-slate-500">
                    {selectedEmpIds.length === 0
                      ? "Select at least one employee to process."
                      : `This will process ${selectedEmpIds.length} of ${employees.length} employee${employees.length === 1 ? "" : "s"} (${fmt(selectedEmployees.reduce((s, e) => s + Number(e.salary), 0), selectedEmployees[0]?.currency)} gross) and log a payroll expense.`}
                  </div>
                  <DialogFooter><Button type="submit" disabled={selectedEmpIds.length === 0} className="bg-slate-900 hover:bg-slate-800" data-testid="run-submit-button">Run</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          <Card className="border-slate-200 shadow-none overflow-hidden">
            <Table>
              <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Employees</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Net</TableHead></TableRow></TableHeader>
              <TableBody>
                {runs.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-10" data-testid="runs-empty">No payroll runs yet.</TableCell></TableRow>
                ) : runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDate(r.period_start)} → {fmtDate(r.period_end)}</TableCell>
                    <TableCell>{r.payslips.length}</TableCell>
                    <TableCell className="text-right">{fmt(r.total_gross, r.payslips[0]?.currency)}</TableCell>
                    <TableCell className="text-right">{fmt(r.total_tax, r.payslips[0]?.currency)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(r.total_net, r.payslips[0]?.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
