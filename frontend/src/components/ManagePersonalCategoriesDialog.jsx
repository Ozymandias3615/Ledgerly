import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { usePersonalCategories, addPersonalCategory, renamePersonalCategory, removePersonalCategory, DEFAULT_INCOME, DEFAULT_EXPENSE } from "@/lib/personalCategories";
import { formatApiError } from "@/lib/utils_app";
import { Tag, Trash, PencilSimple, Check, X } from "@phosphor-icons/react";
import { toast } from "sonner";

function CustomChip({ category, onRemove, onRenamed }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [saving, setSaving] = useState(false);

  const cancel = () => { setEditing(false); setName(category.name); };
  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const renamed = await renamePersonalCategory(category.id, name);
      setEditing(false);
      if (renamed.name !== category.name) {
        toast.success(`Renamed to ${renamed.name}`);
        onRenamed?.();
      }
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="flex items-center gap-1" data-testid={`custom-category-edit-${category.id}`}>
        <Input
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            // Escape cancels the rename instead of closing the whole dialog.
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
          }}
          className="h-7 w-40 text-xs"
          data-testid={`custom-category-rename-input-${category.id}`}
        />
        <button type="button" onClick={save} disabled={saving || !name.trim()} className="rounded text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 p-1" title="Save name" data-testid={`custom-category-rename-save-${category.id}`}>
          <Check size={13} />
        </button>
        <button type="button" onClick={cancel} className="rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1" title="Cancel">
          <X size={13} />
        </button>
      </span>
    );
  }

  return (
    <span className="text-xs pl-2 pr-1 py-1 rounded-md border border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200 flex items-center gap-1" data-testid={`custom-category-${category.id}`}>
      {category.name}
      <button type="button" onClick={() => { setName(category.name); setEditing(true); }} className="rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-0.5" title={`Rename ${category.name}`} data-testid={`custom-category-rename-${category.id}`}>
        <PencilSimple size={12} />
      </button>
      <button type="button" onClick={() => onRemove(category)} className="rounded text-slate-400 hover:text-red-600 hover:bg-red-50 p-0.5" title={`Remove ${category.name}`} data-testid={`custom-category-remove-${category.id}`}>
        <Trash size={12} />
      </button>
    </span>
  );
}

function Section({ type, title, defaults, custom, onRemove, onRenamed }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await addPersonalCategory(type, name);
      setName("");
      toast.success(`Added ${created.name}`);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {defaults.map((c) => (
          <span key={c} className="text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{c}</span>
        ))}
        {custom.map((c) => (
          <CustomChip key={c.id} category={c} onRemove={onRemove} onRenamed={onRenamed} />
        ))}
      </div>
      <form onSubmit={add} className="flex gap-2 mt-3">
        <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={`New ${type} category`} data-testid={`new-${type}-category-input`} />
        <Button type="submit" variant="outline" disabled={saving || !name.trim()} data-testid={`new-${type}-category-submit`}>Add</Button>
      </form>
    </div>
  );
}

// onChanged lets the host page refetch records a rename just updated.
export default function ManagePersonalCategoriesDialog({ onChanged }) {
  const categories = usePersonalCategories();
  const [pendingRemove, setPendingRemove] = useState(null);
  const custom = categories.custom || [];

  const confirmRemove = async () => {
    const c = pendingRemove;
    setPendingRemove(null);
    try {
      await removePersonalCategory(c.id);
      toast.success(`Removed ${c.name}`);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" data-testid="manage-categories-button">
            <Tag size={16} className="mr-2" /> Categories
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Categories</DialogTitle></DialogHeader>
          <div className="text-sm text-slate-500 -mt-2">Built-in categories are shaded. Your own are outlined and can be renamed or removed. Renaming updates everything already using it.</div>
          <div className="space-y-5">
            <Section type="expense" title="Spending" defaults={DEFAULT_EXPENSE} custom={custom.filter((c) => c.type === "expense")} onRemove={setPendingRemove} onRenamed={onChanged} />
            <Section type="income" title="Income" defaults={DEFAULT_INCOME} custom={custom.filter((c) => c.type === "income")} onRemove={setPendingRemove} onRenamed={onChanged} />
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title={`Remove the ${pendingRemove?.name} category?`}
        description="It won't be offered for new entries anymore. Transactions, budgets and bills already using it keep it."
        confirmLabel="Remove"
        onConfirm={confirmRemove}
      />
    </>
  );
}
