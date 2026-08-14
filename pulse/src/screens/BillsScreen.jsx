import { useEffect, useState } from "react";
import api from "../lib/api";
import { fmtAmount, fmtDate } from "../lib/format";
import Brand from "../components/Brand";
import AppShell from "../components/AppShell";

const DUE_SOON_DAYS = 3;

function billStatus(dueDate) {
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return "overdue";
  const soon = new Date();
  soon.setDate(soon.getDate() + DUE_SOON_DAYS);
  if (dueDate <= soon.toISOString().slice(0, 10)) return "due-soon";
  return null;
}

export default function BillsScreen() {
  const [bills, setBills] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = () =>
    api
      .get("/personal/bills")
      .then(({ data }) => setBills(data))
      .catch((err) => setError(err.response?.data?.detail || "Couldn't load your bills."));

  useEffect(() => {
    load();
  }, []);

  const handleMarkPaid = async (bill) => {
    if (!window.confirm(`Mark ${bill.name} as paid? This logs an expense and moves the due date forward.`)) return;
    setBusyId(bill.id);
    try {
      await api.post(`/personal/bills/${bill.id}/mark-paid`);
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't mark this bill paid.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (bill) => {
    if (!window.confirm(`Delete ${bill.name}? This can't be undone.`)) return;
    setBusyId(bill.id);
    try {
      await api.delete(`/personal/bills/${bill.id}`);
      setBills((prev) => prev.filter((b) => b.id !== bill.id));
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't delete this bill.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell>
      <div className="screen screen-narrow">
        <div className="top-row">
          <Brand compact />
        </div>
        <div className="eyebrow">Personal</div>
        <h2 className="heading">Bills</h2>
        <p className="subtitle">Upcoming and recurring bills.</p>

        {error && <p className="error-text">{error}</p>}
        {bills === null && !error && (
          <p className="subtitle thinking">
            <span className="thinking-dots"><span /><span /><span /></span>
            Loading
          </p>
        )}
        {bills && bills.length === 0 && <p className="subtitle">No bills yet.</p>}

        {bills && bills.length > 0 && (
          <div className="list">
            {bills.map((b) => {
              const status = billStatus(b.due_date);
              return (
                <div className="list-card" key={b.id} style={{ flexWrap: "wrap" }}>
                  <div className="list-info">
                    <div className="list-title">
                      {b.name}
                      {status === "overdue" && <span className="status-badge status-badge-overdue" style={{ marginLeft: "0.375rem" }}>Overdue</span>}
                      {status === "due-soon" && <span className="status-badge status-badge-sent" style={{ marginLeft: "0.375rem" }}>Due soon</span>}
                    </div>
                    <div className="list-meta">{b.category} · due {fmtDate(b.due_date)}</div>
                  </div>
                  <div className="list-amount">{fmtAmount(b.amount, b.currency)}</div>
                  <div style={{ display: "flex", gap: "0.375rem", flexBasis: "100%" }}>
                    <button type="button" className="btn-outline" style={{ flex: 1, padding: "0.5rem" }} disabled={busyId === b.id} onClick={() => handleMarkPaid(b)}>
                      Mark paid
                    </button>
                    <button
                      type="button"
                      className="icon-btn list-delete-btn"
                      aria-label="Delete bill"
                      disabled={busyId === b.id}
                      onClick={() => handleDelete(b)}
                    >
                      <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
