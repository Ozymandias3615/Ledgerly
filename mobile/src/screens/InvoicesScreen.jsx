import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { fmt, fmtDate } from "../lib/format";
import Brand from "../components/Brand";
import AppShell from "../components/AppShell";

export default function InvoicesScreen() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get("/invoices")
      .then(({ data }) => {
        if (!cancelled) setInvoices(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.detail || "Couldn't load invoices.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <div className="screen screen-narrow">
        <div className="top-row">
          <Brand compact />
        </div>
        <div className="eyebrow">Billing</div>
        <h2 className="heading">Invoices</h2>
        <p className="subtitle">Track status and export invoices as PDFs.</p>

        {error && <p className="error-text">{error}</p>}
        {invoices === null && !error && (
          <p className="subtitle thinking">
            <span className="thinking-dots"><span /><span /><span /></span>
            Loading
          </p>
        )}
        {invoices && invoices.length === 0 && <p className="subtitle">No invoices yet.</p>}

        {invoices && invoices.length > 0 && (
          <div className="list">
            {invoices.map((inv) => (
              <button
                type="button"
                key={inv.id}
                className="list-card"
                onClick={() => navigate(`/invoices/${inv.id}`, { state: { invoice: inv } })}
              >
                <div className="list-info">
                  <div className="list-title">
                    {inv.invoice_number} · {inv.client_name}
                  </div>
                  <div className="list-meta">
                    {fmtDate(inv.issue_date)} – {fmtDate(inv.due_date)}
                  </div>
                </div>
                <div className="invoice-card-right">
                  <div className="list-amount">{fmt(inv.total, inv.currency)}</div>
                  <span className={`status-badge status-badge-${inv.status}`}>{inv.status}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
