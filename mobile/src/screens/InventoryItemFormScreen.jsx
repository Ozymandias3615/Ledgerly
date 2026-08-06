import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../lib/api";
import Brand from "../components/Brand";
import ThemeToggle from "../components/ThemeToggle";
import BackButton from "../components/BackButton";

const emptyForm = { name: "", category: "", quantity: "", unit: "units", reorder_point: "0", unit_cost: "0" };

function toForm(item) {
  return {
    name: item.name,
    category: item.category || "",
    quantity: String(item.quantity),
    unit: item.unit || "units",
    reorder_point: String(item.reorder_point || 0),
    unit_cost: String(item.unit_cost || 0),
  };
}

export default function InventoryItemFormScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const editing = Boolean(id);

  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(editing);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing) return;
    const passed = location.state?.item;
    if (passed) {
      setForm(toForm(passed));
      setLoading(false);
      return;
    }
    // Deep link / hard refresh into an edit screen has no route state to
    // work with - fall back to the list (no single-item GET endpoint exists).
    api
      .get("/inventory")
      .then(({ data }) => {
        const item = data.find((i) => i.id === id);
        if (!item) {
          setError("Item not found.");
        } else {
          setForm(toForm(item));
        }
      })
      .catch(() => setError("Couldn't load this item."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const payload = {
      name: form.name,
      category: form.category,
      quantity: parseFloat(form.quantity || 0),
      unit: form.unit || "units",
      reorder_point: parseFloat(form.reorder_point || 0),
      unit_cost: parseFloat(form.unit_cost || 0),
    };
    try {
      if (editing) await api.put(`/inventory/${id}`, payload);
      else await api.post("/inventory", payload);
      navigate("/inventory", { replace: true, state: { justSubmitted: true } });
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't save this item.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Remove this item? This can't be undone.")) return;
    setSubmitting(true);
    setError("");
    try {
      await api.delete(`/inventory/${id}`);
      navigate("/inventory", { replace: true });
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't remove this item.");
      setSubmitting(false);
    }
  };

  return (
    <div className="screen screen-narrow">
      <div className="top-row">
        <div className="top-row-left">
          <BackButton to="/inventory" />
          <Brand compact />
        </div>
        <ThemeToggle />
      </div>
      <div className="eyebrow">{editing ? "Edit" : "New"}</div>
      <h2 className="heading">{editing ? "Edit item" : "Add inventory item"}</h2>

      {loading ? (
        <p className="subtitle">Loading…</p>
      ) : (
        <div className="card">
          <form onSubmit={handleSubmit} className="form">
            <label>
              Name
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="inv-name-input" />
            </label>
            <label>
              Category
              <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Optional" />
            </label>
            <label>
              Quantity
              <input type="number" inputMode="decimal" step="0.01" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required data-testid="inv-quantity-input" />
            </label>
            <label>
              Unit
              <input type="text" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="units, kg, boxes..." />
            </label>
            <label>
              Low stock threshold
              <input type="number" inputMode="decimal" step="0.01" min="0" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: e.target.value })} />
            </label>
            <label>
              Unit cost
              <input type="number" inputMode="decimal" step="0.01" min="0" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
            </label>
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="btn-primary" disabled={submitting} data-testid="inv-submit-button">
              {submitting ? "Saving…" : editing ? "Save changes" : "Add item"}
            </button>
            {editing && (
              <button type="button" className="btn-outline" onClick={handleDelete} disabled={submitting}>
                Remove item
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
