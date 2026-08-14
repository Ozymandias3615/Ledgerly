import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmt, fmtDate, formatApiError } from "@/lib/utils_app";
import { Trash, Check } from "@phosphor-icons/react";
import { toast } from "sonner";

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
  const [bills, setBills] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [pendingMarkPaid, setPendingMarkPaid] = useState(null);

  const load = () => api.get("/personal/bills").then(({ data }) => setBills(data));
  useEffect(() => { load(); }, []);

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
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Personal</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Bills</h1>
        <div className="text-sm text-slate-500 mt-1">Upcoming and recurring bills</div>
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
                      <button
                        type="button"
                        onClick={() => setPendingRemove(b)}
                        className="h-8 w-8 shrink-0 grid place-items-center rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete bill"
                        data-testid={`bill-delete-${b.id}`}
                      >
                        <Trash size={16} />
                      </button>
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
