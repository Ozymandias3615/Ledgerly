import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Camera } from "@phosphor-icons/react";
import api from "../lib/api";
import { fmtDate, fmtAmount } from "../lib/format";
import { getUser } from "../lib/auth";
import Brand from "../components/Brand";
import AppShell from "../components/AppShell";

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function TransactionsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const justSubmitted = Boolean(location.state?.justSubmitted);
  const user = getUser();
  const [transactions, setTransactions] = useState(null);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const loadTransactions = () =>
    api
      .get("/personal/transactions")
      .then(({ data }) => setTransactions(data))
      .catch((err) => setError(err.response?.data?.detail || "Couldn't load your transactions."));

  useEffect(() => {
    loadTransactions();
  }, []);

  const handleDelete = async (tx) => {
    if (!window.confirm("Delete this transaction? This can't be undone.")) return;
    setDeletingId(tx.id);
    try {
      await api.delete(`/personal/transactions/${tx.id}`);
      setTransactions((prev) => prev.filter((t) => t.id !== tx.id));
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't delete this transaction.");
    } finally {
      setDeletingId(null);
    }
  };

  const monthKey = currentMonthKey();
  const thisMonth = (transactions || []).filter((tx) => tx.date?.slice(0, 7) === monthKey);
  const income = thisMonth.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const expense = thisMonth.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

  return (
    <AppShell>
      <div className="screen screen-narrow">
        <div className="top-row">
          <Brand compact />
          <div className="top-row-left">
            <button type="button" className="icon-btn" aria-label="Scan a receipt" title="Scan a receipt" onClick={() => navigate("/capture")}>
              <Camera size={18} />
            </button>
            <button type="button" className="icon-btn" aria-label="Add a transaction" title="Add a transaction" onClick={() => navigate("/transactions/new")}>
              <Plus size={18} />
            </button>
          </div>
        </div>
        <div className="eyebrow">Personal</div>
        <h2 className="heading">Transactions</h2>
        <p className="subtitle">Everything you've logged.</p>

        {justSubmitted && <div className="banner banner-success">Transaction saved.</div>}
        {error && <p className="error-text">{error}</p>}

        {transactions === null && !error && (
          <p className="subtitle thinking">
            <span className="thinking-dots"><span /><span /><span /></span>
            Loading
          </p>
        )}

        {transactions !== null && transactions.length > 0 && (
          <div className="totals-box">
            <div className="totals-row">
              <span>This month's income</span>
              <span>{fmtAmount(income, user?.currency)}</span>
            </div>
            <div className="totals-row">
              <span>This month's expenses</span>
              <span>{fmtAmount(expense, user?.currency)}</span>
            </div>
            <div className="totals-row-bold">
              <span>Net</span>
              <span>{fmtAmount(income - expense, user?.currency)}</span>
            </div>
          </div>
        )}

        {transactions !== null && transactions.length === 0 && (
          <p className="subtitle">No transactions yet. Tap + to add your first one.</p>
        )}

        {transactions && transactions.length > 0 && (
          <div className="list">
            {transactions.map((tx) => (
              <div
                className="list-card"
                key={tx.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/transactions/${tx.id}/edit`, { state: { transaction: tx } })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate(`/transactions/${tx.id}/edit`, { state: { transaction: tx } });
                }}
              >
                <div className="list-info">
                  <div className="list-title">
                    {tx.category}
                    {tx.description ? ` · ${tx.description}` : ""}
                  </div>
                  <div className="list-meta">{fmtDate(tx.date)}</div>
                </div>
                <div className={`list-amount ${tx.type === "income" ? "stat-positive" : "stat-negative"}`}>
                  {tx.type === "income" ? "+" : "-"}
                  {fmtAmount(tx.amount, tx.currency)}
                </div>
                <button
                  type="button"
                  className="icon-btn list-delete-btn"
                  aria-label="Delete transaction"
                  disabled={deletingId === tx.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(tx);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
