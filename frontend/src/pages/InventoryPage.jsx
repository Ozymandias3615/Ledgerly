import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmt, exportAndDownload } from "@/lib/utils_app";
import { Plus, Minus, Package, Warning, DotsThreeVertical, PencilSimple, Trash, Download } from "@phosphor-icons/react";
import { toast } from "sonner";

const emptyForm = { name: "", category: "", quantity: "", unit: "units", reorder_point: "0", unit_cost: "0" };

function isLow(item) {
  return Number(item.reorder_point) > 0 && Number(item.quantity) <= Number(item.reorder_point);
}

// Scales the bar to "full" at 2x the reorder point, since there's no separate
// max-stock field — once stock reaches double the restock threshold, the bar
// reads as full. Items with no threshold set just show a neutral full bar.
function stockRatio(item) {
  const reorderPoint = Number(item.reorder_point);
  if (reorderPoint <= 0) return 1;
  return Math.max(0, Math.min(1, Number(item.quantity) / (reorderPoint * 2)));
}

function StockBar({ item }) {
  const low = isLow(item);
  const ratio = stockRatio(item);
  const reorderPoint = Number(item.reorder_point);
  const color = reorderPoint <= 0 ? "bg-slate-300" : low ? "bg-red-500" : ratio < 0.75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="w-28">
      <div className="text-sm font-semibold text-slate-900">{item.quantity} <span className="text-xs font-normal text-slate-500">{item.unit}</span></div>
      <div className="h-1.5 rounded-full bg-slate-100 mt-1 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

function KPI({ label, value, Icon, tone = "default", testId }) {
  return (
    <Card className="p-5 border-slate-200 shadow-none" data-testid={testId}>
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
        {Icon && <Icon size={18} weight="duotone" className="text-slate-400" />}
      </div>
      <div className={`mt-2 text-3xl font-extrabold tracking-tight ${tone === "danger" ? "text-red-600" : "text-slate-900"}`} style={{ fontFamily: "Manrope, sans-serif" }}>
        {value}
      </div>
    </Card>
  );
}

export default function InventoryPage() {
  const { user } = useAuth();
  const cur = user?.currency || "USD";
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const notified = useRef(false);
  const pendingSaves = useRef({});

  const load = async () => {
    const { data } = await api.get("/inventory");
    setItems(data);
    setLoading(false);
    return data;
  };

  useEffect(() => {
    load().then((data) => {
      const low = data.filter(isLow);
      if (low.length > 0 && !notified.current) {
        notified.current = true;
        toast.warning(
          low.length === 1
            ? `${low[0].name} is running low (${low[0].quantity} ${low[0].unit} left)`
            : `${low.length} items are running low on stock`
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lowStockItems = useMemo(() => items.filter(isLow), [items]);
  const totalValue = useMemo(() => items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost || 0), 0), [items]);

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name,
      category: item.category || "",
      quantity: String(item.quantity),
      unit: item.unit || "units",
      reorder_point: String(item.reorder_point || 0),
      unit_cost: String(item.unit_cost || 0),
    });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      category: form.category,
      quantity: parseFloat(form.quantity || 0),
      unit: form.unit || "units",
      reorder_point: parseFloat(form.reorder_point || 0),
      unit_cost: parseFloat(form.unit_cost || 0),
    };
    try {
      if (editing) await api.put(`/inventory/${editing.id}`, payload);
      else await api.post("/inventory", payload);
      toast.success(editing ? "Item updated" : "Item added");
      setOpen(false);
      load();
    } catch (err) {
      toast.error("Failed to save");
    }
  };

  const exportFile = (format) => exportAndDownload(
    async () => (await api.get(`/export/inventory?format=${format}`, { responseType: "blob" })).data,
    `inventory.${format}`,
  );

  const remove = async (item) => {
    if (!window.confirm(`Remove ${item.name} from inventory?`)) return;
    await api.delete(`/inventory/${item.id}`);
    toast.success("Removed");
    load();
  };

  // Tracks the latest intended quantity per item in a plain ref (not React
  // state) so rapid repeated clicks stack correctly: reading the result back
  // from setItems's updater isn't reliable here, since React only guarantees
  // synchronous eager evaluation for the first update in an otherwise-empty
  // queue, not for a burst of calls in the same tick. The actual save is
  // debounced per item so a burst of clicks becomes a single request for the
  // final settled quantity.
  const pendingQty = useRef({});

  const adjustQty = (item, delta) => {
    const base = pendingQty.current[item.id] ?? item.quantity;
    const quantity = Math.max(0, Number(base) + delta);
    pendingQty.current[item.id] = quantity;

    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, quantity } : i)));

    clearTimeout(pendingSaves.current[item.id]);
    pendingSaves.current[item.id] = setTimeout(() => {
      delete pendingQty.current[item.id];
      api.put(`/inventory/${item.id}`, {
        name: item.name,
        category: item.category,
        quantity,
        unit: item.unit,
        reorder_point: item.reorder_point,
        unit_cost: item.unit_cost,
      }).catch(() => {
        toast.error("Failed to update stock");
        load();
      });
    }, 400);
  };

  return (
    <div className="p-8 space-y-6" data-testid="inventory-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Stock</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Inventory</h1>
          <div className="text-sm text-slate-500 mt-1">Track what you have on hand and know when to restock</div>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="export-inventory-button"><Download size={16} className="mr-2" /> Export</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => exportFile("csv")} data-testid="export-csv">Export CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportFile("xlsx")} data-testid="export-xlsx">Export XLSX</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportFile("pdf")} data-testid="export-pdf">Export PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} className="bg-slate-900 hover:bg-slate-800" data-testid="add-inventory-button">
                <Plus size={16} className="mr-2" /> Add item
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} inventory item</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="inv-name-input" />
              </div>
              <div>
                <Label>Category</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Optional" data-testid="inv-category-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Quantity</Label>
                  <Input type="number" step="0.01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required data-testid="inv-quantity-input" />
                </div>
                <div>
                  <Label>Unit</Label>
                  <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="units, kg, boxes..." data-testid="inv-unit-input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Low stock threshold</Label>
                  <Input type="number" step="0.01" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: e.target.value })} data-testid="inv-reorder-input" />
                  <div className="text-xs text-slate-400 mt-1">Get a reminder at or below this level</div>
                </div>
                <div>
                  <Label>Unit cost</Label>
                  <Input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} data-testid="inv-cost-input" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" className="bg-slate-900 hover:bg-slate-800" data-testid="inv-submit-button">{editing ? "Update" : "Add"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {lowStockItems.length > 0 && (
        <Card className="p-4 border-red-200 bg-red-50 shadow-none flex items-center gap-3" data-testid="low-stock-banner">
          <Warning size={20} weight="fill" className="text-red-600 shrink-0" />
          <div className="text-sm text-red-700">
            <span className="font-semibold">{lowStockItems.length} item{lowStockItems.length > 1 ? "s" : ""} running low: </span>
            {lowStockItems.map((i) => i.name).join(", ")}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI label="Items tracked" value={items.length} Icon={Package} testId="kpi-item-count" />
        <KPI label="Inventory value" value={fmt(totalValue, cur)} Icon={Package} testId="kpi-inventory-value" />
        <KPI label="Running low" value={lowStockItems.length} Icon={Warning} tone={lowStockItems.length > 0 ? "danger" : "default"} testId="kpi-low-stock" />
      </div>

      <Card className="border-slate-200 shadow-none overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-8">Loading...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-slate-500 py-10" data-testid="inv-empty">No items yet. Add your first one.</TableCell></TableRow>
            ) : items.map((item) => (
              <TableRow key={item.id} className={isLow(item) ? "bg-red-50/60" : ""} data-testid={`inv-row-${item.id}`}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell className="text-sm text-slate-600">{item.category || "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => adjustQty(item, -1)}
                      className="h-6 w-6 shrink-0 grid place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                      data-testid={`inv-decrement-${item.id}`}
                      title="Decrease by 1"
                    >
                      <Minus size={12} />
                    </button>
                    <StockBar item={item} />
                    <button
                      type="button"
                      onClick={() => adjustQty(item, 1)}
                      className="h-6 w-6 shrink-0 grid place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                      data-testid={`inv-increment-${item.id}`}
                      title="Increase by 1"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </TableCell>
                <TableCell className="text-right text-sm text-slate-600">{fmt(item.unit_cost || 0, cur)}</TableCell>
                <TableCell className="text-right font-semibold">{fmt(Number(item.quantity) * Number(item.unit_cost || 0), cur)}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 hover:bg-slate-100 rounded" data-testid={`inv-menu-${item.id}`}><DotsThreeVertical size={18} /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => openEdit(item)}><PencilSimple size={14} className="mr-2" /> Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => remove(item)} className="text-red-600"><Trash size={14} className="mr-2" /> Remove</DropdownMenuItem>
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
