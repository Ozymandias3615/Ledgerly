import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, DotsThreeVertical, PencilSimple, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

const emptyForm = { name: "", type: "client", email: "", phone: "", address: "", notes: "" };

function ContactTable({ items, onEdit, onRemove, emptyLabel }) {
  return (
    <Card className="border-slate-200 shadow-none overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow><TableCell colSpan={5} className="text-center text-slate-500 py-10">{emptyLabel}</TableCell></TableRow>
          ) : items.map((c) => (
            <TableRow key={c.id} data-testid={`contact-row-${c.id}`}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell className="text-sm text-slate-600">{c.email || "—"}</TableCell>
              <TableCell className="text-sm text-slate-600">{c.phone || "—"}</TableCell>
              <TableCell className="text-sm text-slate-500 max-w-xs truncate">{c.notes || "—"}</TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1 hover:bg-slate-100 rounded" data-testid={`contact-menu-${c.id}`}><DotsThreeVertical size={18} /></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => onEdit(c)}><PencilSimple size={14} className="mr-2" /> Edit</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onRemove(c)} className="text-red-600"><Trash size={14} className="mr-2" /> Remove</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default function ClientsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const { data } = await api.get("/clients");
    setItems(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const clients = useMemo(() => items.filter((c) => c.type === "client"), [items]);
  const vendors = useMemo(() => items.filter((c) => c.type === "vendor"), [items]);

  const openNew = (type) => { setEditing(null); setForm({ ...emptyForm, type }); setOpen(true); };
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, type: c.type, email: c.email || "", phone: c.phone || "", address: c.address || "", notes: c.notes || "" }); setOpen(true); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing) await api.put(`/clients/${editing.id}`, form);
      else await api.post("/clients", form);
      toast.success(editing ? "Contact updated" : "Contact added");
      setOpen(false);
      load();
    } catch (err) {
      toast.error("Failed to save");
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Remove ${c.name}?`)) return;
    await api.delete(`/clients/${c.id}`);
    toast.success("Removed");
    load();
  };

  return (
    <div className="p-8 space-y-6" data-testid="clients-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Contacts</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Clients &amp; Vendors</h1>
          <div className="text-sm text-slate-500 mt-1">A saved directory you can pick from when creating invoices</div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} contact</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="contact-name-input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="contact-email-input" /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="contact-phone-input" /></div>
            </div>
            <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Optional" data-testid="contact-address-input" /></div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" data-testid="contact-notes-input" /></div>
            <DialogFooter><Button type="submit" className="bg-slate-900 hover:bg-slate-800" data-testid="contact-submit-button">{editing ? "Update" : "Add"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="clients">
        <TabsList data-testid="contacts-tabs">
          <TabsTrigger value="clients" data-testid="tab-clients">Clients</TabsTrigger>
          <TabsTrigger value="vendors" data-testid="tab-vendors">Vendors</TabsTrigger>
        </TabsList>

        <TabsContent value="clients" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => openNew("client")} className="bg-slate-900 hover:bg-slate-800" data-testid="add-client-button">
              <Plus size={16} className="mr-2" /> Add client
            </Button>
          </div>
          {loading ? (
            <div className="text-center text-slate-500 py-10">Loading...</div>
          ) : (
            <ContactTable items={clients} onEdit={openEdit} onRemove={remove} emptyLabel="No clients yet. Add your first one." />
          )}
        </TabsContent>

        <TabsContent value="vendors" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => openNew("vendor")} className="bg-slate-900 hover:bg-slate-800" data-testid="add-vendor-button">
              <Plus size={16} className="mr-2" /> Add vendor
            </Button>
          </div>
          {loading ? (
            <div className="text-center text-slate-500 py-10">Loading...</div>
          ) : (
            <ContactTable items={vendors} onEdit={openEdit} onRemove={remove} emptyLabel="No vendors yet. Add your first one." />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
