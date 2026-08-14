import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../lib/api";
import { getUser } from "../lib/auth";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "../lib/categories";
import { fmtAmount, fmtDate } from "../lib/format";
import Brand from "../components/Brand";
import BackButton from "../components/BackButton";

function today() {
  return new Date().toISOString().slice(0, 10);
}

const emptyForm = { type: "expense", amount: "", category: EXPENSE_CATEGORIES[0], date: today(), description: "", billId: "" };

function toForm(tx) {
  return {
    type: tx.type,
    amount: String(tx.amount),
    category: tx.category || (tx.type === "income" ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]),
    date: tx.date,
    description: tx.description || "",
    billId: tx.bill_id || "",
  };
}

export default function TransactionFormScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const editing = Boolean(id);

  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(editing);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [bills, setBills] = useState([]);

  useEffect(() => {
    api.get("/personal/bills").then(({ data }) => setBills(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editing) return;
    const passed = location.state?.transaction;
    if (passed) {
      setForm(toForm(passed));
      setLoading(false);
      return;
    }
    // Deep link / hard refresh into an edit screen has no route state to
    // work with - fall back to the list (no single-item GET endpoint exists).
    api
      .get("/personal/transactions")
      .then(({ data }) => {
        const tx = data.find((t) => t.id === id);
        if (!tx) {
          setError("Transaction not found.");
        } else {
          setForm(toForm(tx));
        }
      })
      .catch(() => setError("Couldn't load this transaction."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, id]);

  const categories = form.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const setType = (type) => {
    const nextCategories = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    setForm({ ...form, type, category: nextCategories.includes(form.category) ? form.category : nextCategories[0] });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const payload = {
      type: form.type,
      amount: parseFloat(form.amount || 0),
      category: form.category,
      description: form.description,
      date: form.date,
      currency: getUser()?.currency || "USD",
      bill_id: form.type === "expense" && form.billId ? form.billId : null,
    };
    try {
      if (editing) await api.put(`/personal/transactions/${id}`, payload);
      else await api.post("/personal/transactions", payload);
      navigate("/transactions", { replace: true, state: { justSubmitted: true } });
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't save this transaction.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this transaction? This can't be undone.")) return;
    setSubmitting(true);
    setError("");
    try {
      await api.delete(`/personal/transactions/${id}`);
      navigate("/transactions", { replace: true });
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't delete this transaction.");
      setSubmitting(false);
    }
  };

  return (
    <div className="screen screen-narrow">
      <div className="top-row">
        <div className="top-row-left">
          <BackButton to="/transactions" />
          <Brand compact />
        </div>
      </div>
      <div className="eyebrow">{editing ? "Edit" : "New"}</div>
      <h2 className="heading">{editing ? "Edit transaction" : "Add transaction"}</h2>

      {loading ? (
        <p className="subtitle thinking">
          <span className="thinking-dots"><span /><span /><span /></span>
          Loading
        </p>
      ) : (
        <div className="card">
          <form onSubmit={handleSubmit} className="form">
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className={form.type === "expense" ? "btn-primary" : "btn-outline"} style={{ flex: 1 }} onClick={() => setType("expense")}>
                Expense
              </button>
              <button type="button" className={form.type === "income" ? "btn-primary" : "btn-outline"} style={{ flex: 1 }} onClick={() => setType("income")}>
                Income
              </button>
            </div>
            <label>
              Amount
              <input type="number" inputMode="decimal" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required data-testid="tx-amount-input" />
            </label>
            <label>
              Category
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            {form.type === "expense" && bills.length > 0 && (
              <label>
                Pay a bill (optional)
                <select
                  value={form.billId}
                  onChange={(e) => {
                    const billId = e.target.value;
                    const bill = bills.find((b) => b.id === billId);
                    setForm({ ...form, billId, category: bill ? bill.category : form.category });
                  }}
                >
                  <option value="">None</option>
                  {bills.map((b) => (
                    <option key={b.id} value={b.id}>{b.name} · {fmtAmount(b.amount, b.currency)} · due {fmtDate(b.due_date)}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Date
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </label>
            <label>
              Description
              <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
            </label>
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="btn-primary" disabled={submitting} data-testid="tx-submit-button">
              {submitting ? "Saving…" : editing ? "Save changes" : "Add transaction"}
            </button>
            {editing && (
              <button type="button" className="btn-outline" onClick={handleDelete} disabled={submitting}>
                Delete transaction
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
