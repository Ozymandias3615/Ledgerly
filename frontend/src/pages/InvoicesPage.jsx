import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { API } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CURRENCIES, fmt, fmtDate, exportAndDownload } from "@/lib/utils_app";
import { Plus, Download, DotsThreeVertical, PencilSimple, Trash, FilePdf, X } from "@phosphor-icons/react";
import { toast } from "sonner";

const emptyItem = () => ({ description: "", quantity: 1, unit_price: 0, item_id: null });

export default function InvoicesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [clients, setClients] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const emptyForm = {
    client_name: "", client_email: "", client_address: "", client_id: null,
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    currency: user?.currency || "USD", tax_rate: 0, notes: "", status: "draft",
    items: [emptyItem()],
  };
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const { data } = await api.get("/invoices");
    setItems(data);
  };
  useEffect(() => {
    load();
    api.get("/clients").then(({ data }) => setClients(data.filter((c) => c.type === "client")));
    api.get("/inventory").then(({ data }) => setInventory(data));
  }, []);

  const pickClient = (clientId) => {
    if (clientId === "__manual__") {
      setForm({ ...form, client_id: null });
      return;
    }
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    setForm({ ...form, client_id: c.id, client_name: c.name, client_email: c.email || "", client_address: c.address || "" });
  };

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (inv) => { setEditing(inv); setForm({ ...inv }); setOpen(true); };

  const totals = (() => {
    const sub = form.items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);
    const tax = sub * Number(form.tax_rate || 0) / 100;
    return { sub, tax, total: sub + tax };
  })();

  const setItem = (idx, k, v) => {
    const next = [...form.items];
    next[idx] = { ...next[idx], [k]: k === "description" ? v : Number(v) };
    setForm({ ...form, items: next });
  };

  const pickInventoryItem = (idx, itemId) => {
    const next = [...form.items];
    if (itemId === "__manual__") {
      next[idx] = { ...next[idx], item_id: null };
    } else {
      const invItem = inventory.find((i) => i.id === itemId);
      if (!invItem) return;
      next[idx] = { ...next[idx], item_id: invItem.id, description: invItem.name, unit_price: Number(invItem.unit_cost || 0) };
    }
    setForm({ ...form, items: next });
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      tax_rate: Number(form.tax_rate || 0),
      items: form.items.map((it) => ({ description: it.description, quantity: Number(it.quantity), unit_price: Number(it.unit_price), item_id: it.item_id || null })),
    };
    try {
      if (editing) await api.put(`/invoices/${editing.id}`, payload);
      else await api.post("/invoices", payload);
      toast.success(editing ? "Invoice updated" : "Invoice created");
      setOpen(false);
      load();
    } catch { toast.error("Failed to save"); }
  };

  const remove = async (inv) => {
    if (!window.confirm(`Delete invoice ${inv.invoice_number}?`)) return;
    await api.delete(`/invoices/${inv.id}`);
    load();
  };

  const downloadPdf = (inv) => exportAndDownload(
    async () => (await api.get(`/invoices/${inv.id}/pdf`, { responseType: "blob" })).data,
    `${inv.invoice_number}.pdf`,
  );

  const exportFile = (format) => exportAndDownload(
    async () => (await api.get(`/export/invoices?format=${format}`, { responseType: "blob" })).data,
    `invoices.${format}`,
  );

  const statusColor = (s) => ({
    draft: "bg-slate-100 text-slate-700",
    sent: "bg-blue-50 text-blue-700",
    paid: "bg-emerald-50 text-emerald-700",
    overdue: "bg-red-50 text-red-700",
  }[s] || "bg-slate-100 text-slate-700");

  return (
    <div className="p-8 space-y-6" data-testid="invoices-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Billing</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Invoices</h1>
          <div className="text-sm text-slate-500 mt-1">Create professional invoices and download PDFs</div>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" data-testid="export-invoices-button"><Download size={16} className="mr-2" /> Export</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => exportFile("csv")}>Export CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportFile("xlsx")}>Export XLSX</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportFile("pdf")}>Export PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew} className="bg-slate-900 hover:bg-slate-800" data-testid="new-invoice-button"><Plus size={16} className="mr-2" /> New invoice</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editing ? `Edit ${editing.invoice_number}` : "New invoice"}</DialogTitle></DialogHeader>
              <form onSubmit={save} className="space-y-4">
                <div>
                  <Label>Client directory</Label>
                  {clients.length > 0 ? (
                    <Select value={form.client_id || "__manual__"} onValueChange={pickClient}>
                      <SelectTrigger data-testid="inv-client-picker"><SelectValue placeholder="Pick a saved client, or enter manually below" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__manual__">Enter manually</SelectItem>
                        {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="text-xs text-slate-500 border border-dashed border-slate-200 rounded-md px-3 py-2">
                      No saved clients yet. <Link to="/clients" className="text-slate-900 underline font-medium">Add one</Link> to reuse their details next time, or just enter this client manually below.
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Client name</Label><Input required value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} data-testid="inv-client-name-input" /></div>
                  <div><Label>Client email</Label><Input type="email" value={form.client_email} onChange={(e) => setForm({ ...form, client_email: e.target.value })} data-testid="inv-client-email-input" /></div>
                </div>
                <div><Label>Client address</Label><Input value={form.client_address} onChange={(e) => setForm({ ...form, client_address: e.target.value })} /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>Issue date</Label><Input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} required /></div>
                  <div><Label>Due date</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} required /></div>
                  <div><Label>Currency</Label><Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent></Select></div>
                </div>

                <div className="border border-slate-200 rounded-md">
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-slate-50 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    <div className="col-span-6">Description</div>
                    <div className="col-span-2 text-right">Qty</div>
                    <div className="col-span-3 text-right">Unit price</div>
                    <div className="col-span-1"></div>
                  </div>
                  {form.items.map((it, idx) => (
                    <div key={idx} className="px-3 py-2 border-t border-slate-100 space-y-1.5">
                      {inventory.length > 0 && (
                        <Select value={it.item_id || "__manual__"} onValueChange={(v) => pickInventoryItem(idx, v)}>
                          <SelectTrigger className="h-8 text-xs" data-testid={`inv-item-inventory-picker-${idx}`}>
                            <SelectValue placeholder="From inventory (optional)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__manual__">Not from inventory</SelectItem>
                            {inventory.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit} left)</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <Input className="col-span-6" value={it.description} onChange={(e) => setItem(idx, "description", e.target.value)} required data-testid={`inv-item-desc-${idx}`} />
                        <Input className="col-span-2 text-right" type="number" step="0.01" value={it.quantity} onChange={(e) => setItem(idx, "quantity", e.target.value)} />
                        <Input className="col-span-3 text-right" type="number" step="0.01" value={it.unit_price} onChange={(e) => setItem(idx, "unit_price", e.target.value)} />
                        <button type="button" className="col-span-1 justify-self-end p-1 text-slate-400 hover:text-red-600" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })} disabled={form.items.length === 1}><X size={16} /></button>
                      </div>
                    </div>
                  ))}
                  <div className="p-2 border-t border-slate-100">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })} data-testid="inv-add-item-button"><Plus size={14} className="mr-1" /> Add line</Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Tax rate (%)</Label><Input type="number" step="0.01" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} /></div>
                  <div><Label>Status</Label><Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="sent">Sent</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="overdue">Overdue</SelectItem></SelectContent></Select></div>
                </div>
                <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>

                <div className="bg-slate-50 rounded-md p-4 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-slate-600">Subtotal</span><span>{fmt(totals.sub, form.currency)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Tax</span><span>{fmt(totals.tax, form.currency)}</span></div>
                  <div className="flex justify-between font-bold border-t border-slate-200 pt-1 mt-1"><span>Total</span><span data-testid="inv-total-preview">{fmt(totals.total, form.currency)}</span></div>
                </div>

                <DialogFooter><Button type="submit" className="bg-slate-900 hover:bg-slate-800" data-testid="inv-submit-button">{editing ? "Update" : "Create"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="border-slate-200 shadow-none overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-slate-500 py-10" data-testid="inv-empty">No invoices yet.</TableCell></TableRow>
            ) : items.map((inv) => (
              <TableRow key={inv.id} data-testid={`inv-row-${inv.id}`}>
                <TableCell className="font-semibold">{inv.invoice_number}</TableCell>
                <TableCell>{inv.client_name}</TableCell>
                <TableCell className="text-sm text-slate-600">{fmtDate(inv.issue_date)}</TableCell>
                <TableCell className="text-sm text-slate-600">{fmtDate(inv.due_date)}</TableCell>
                <TableCell><span className={`text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded ${statusColor(inv.status)}`}>{inv.status}</span></TableCell>
                <TableCell className="text-right font-semibold">{fmt(inv.total, inv.currency)}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><button className="p-1 hover:bg-slate-100 rounded" data-testid={`inv-menu-${inv.id}`}><DotsThreeVertical size={18} /></button></DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => downloadPdf(inv)} data-testid={`inv-pdf-${inv.id}`}><FilePdf size={14} className="mr-2" /> Download PDF</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openEdit(inv)}><PencilSimple size={14} className="mr-2" /> Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => remove(inv)} className="text-red-600"><Trash size={14} className="mr-2" /> Delete</DropdownMenuItem>
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
