import { useState } from "react";
import { usePersonalCategories, addPersonalCategory } from "../lib/categories";

const NEW_CATEGORY = "__new_category__";

// Built-in + the user's own categories, with an "Add new category" option
// that saves it for next time too. `extra` is a one-off option (e.g. the AI's
// suggestion on a scanned receipt) shown at the top without being saved.
export default function CategorySelect({ type, value, onChange, extra, extraLabel }) {
  const categories = usePersonalCategories();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const options = categories[type] || [];
  // Keep a category that's no longer in the list (e.g. removed on desktop)
  // selectable, so editing an old transaction doesn't blank it out.
  const orphan = value && value !== extra && !options.includes(value) ? value : null;

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const created = await addPersonalCategory(type, name);
      onChange(created.name);
      setAdding(false);
      setName("");
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't add this category.");
    } finally {
      setSaving(false);
    }
  };

  if (adding) {
    return (
      <>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="text"
            autoFocus
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            // Enter would otherwise submit the surrounding form.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            placeholder="New category name"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn-primary" disabled={saving || !name.trim()} onClick={save}>
            Add
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={() => {
              setAdding(false);
              setName("");
              setError("");
            }}
          >
            Cancel
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </>
    );
  }

  return (
    <select value={value} onChange={(e) => (e.target.value === NEW_CATEGORY ? setAdding(true) : onChange(e.target.value))}>
      {extra && <option value={extra}>{extraLabel || extra}</option>}
      {options.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
      {orphan && <option value={orphan}>{orphan}</option>}
      <option value={NEW_CATEGORY}>+ Add new category…</option>
    </select>
  );
}
