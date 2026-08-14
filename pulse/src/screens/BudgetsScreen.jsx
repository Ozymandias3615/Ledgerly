import { useEffect, useState } from "react";
import api from "../lib/api";
import { fmtAmount, budgetRatio, budgetBarColor } from "../lib/format";
import { getUser } from "../lib/auth";
import Brand from "../components/Brand";
import AppShell from "../components/AppShell";

export default function BudgetsScreen() {
  const user = getUser();
  const [budgets, setBudgets] = useState(null);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const load = () =>
    api
      .get("/personal/budgets/summary")
      .then(({ data }) => setBudgets(data))
      .catch((err) => setError(err.response?.data?.detail || "Couldn't load your budgets."));

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (budget) => {
    if (!window.confirm(`Delete the ${budget.category} budget? This can't be undone.`)) return;
    setDeletingId(budget.id);
    try {
      await api.delete(`/personal/budgets/${budget.id}`);
      setBudgets((prev) => prev.filter((b) => b.id !== budget.id));
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't delete this budget.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell>
      <div className="screen screen-narrow">
        <div className="top-row">
          <Brand compact />
        </div>
        <div className="eyebrow">Personal</div>
        <h2 className="heading">Budgets</h2>
        <p className="subtitle">Where you stand against this month's limits.</p>

        {error && <p className="error-text">{error}</p>}
        {budgets === null && !error && (
          <p className="subtitle thinking">
            <span className="thinking-dots"><span /><span /><span /></span>
            Loading
          </p>
        )}
        {budgets && budgets.length === 0 && <p className="subtitle">No budgets set yet.</p>}

        {budgets && budgets.length > 0 && (
          <div className="list">
            {budgets.map((b) => (
              <div className="list-card" key={b.id} style={{ flexWrap: "wrap" }}>
                <div className="list-info">
                  <div className="list-title">{b.category}</div>
                  <div className="list-meta">
                    {fmtAmount(b.spent, b.currency)} of {fmtAmount(b.monthly_limit, b.currency)}
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn list-delete-btn"
                  aria-label="Delete budget"
                  disabled={deletingId === b.id}
                  onClick={() => handleDelete(b)}
                >
                  <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z" />
                  </svg>
                </button>
                <div className="stock-bar-track">
                  <div
                    className="stock-bar-fill"
                    style={{ width: `${budgetRatio(b.spent, b.monthly_limit) * 100}%`, background: budgetBarColor(b.spent, b.monthly_limit) }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
