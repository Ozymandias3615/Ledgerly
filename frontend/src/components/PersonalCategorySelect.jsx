import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePersonalCategories, addPersonalCategory } from "@/lib/personalCategories";
import { formatApiError } from "@/lib/utils_app";
import { Plus } from "@phosphor-icons/react";
import { toast } from "sonner";

const NEW_CATEGORY = "__new_category__";

// Category picker for Personal forms: built-in + the user's own categories,
// with an inline "Add new category" that saves it for next time too.
export default function PersonalCategorySelect({ type, value, onChange, disabled, testId = "category-select" }) {
  const categories = usePersonalCategories();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const options = categories[type] || [];
  // A record can still carry a category that was since removed from the
  // list - keep it selectable so editing doesn't silently blank it out.
  const shown = value && !options.includes(value) ? [...options, value] : options;

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await addPersonalCategory(type, name);
      onChange(created.name);
      setAdding(false);
      setName("");
      toast.success(`Added ${created.name}`);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (adding) {
    return (
      <div className="flex gap-2">
        <Input
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          // Enter would otherwise submit the surrounding form.
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
          placeholder="New category name"
          data-testid={`${testId}-new-input`}
        />
        <Button type="button" onClick={save} disabled={saving || !name.trim()} data-testid={`${testId}-new-save`}>Add</Button>
        <Button type="button" variant="outline" onClick={() => { setAdding(false); setName(""); }}>Cancel</Button>
      </div>
    );
  }

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => (v === NEW_CATEGORY ? setAdding(true) : onChange(v))}
    >
      <SelectTrigger data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>
        {shown.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        <SelectSeparator />
        <SelectItem value={NEW_CATEGORY} className="font-medium" data-testid={`${testId}-new`}>
          <span className="flex items-center gap-1.5"><Plus size={13} /> Add new category</span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
