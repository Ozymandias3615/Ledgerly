import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { DownloadSimple } from "@phosphor-icons/react";
import api from "../lib/api";
import { fmt, fmtDate } from "../lib/format";
import Brand from "../components/Brand";
import BackButton from "../components/BackButton";

const STATUSES = ["draft", "sent", "paid", "overdue"];
const STATUS_LABELS = { draft: "Draft", sent: "Sent", paid: "Paid", overdue: "Overdue" };

export default function InvoiceDetailScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  const [invoice, setInvoice] = useState(location.state?.invoice || null);
  const [loading, setLoading] = useState(!location.state?.invoice);
  const [updating, setUpdating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (invoice) return;
    api
      .get(`/invoices/${id}`)
      .then(({ data }) => setInvoice(data))
      .catch(() => setError("Couldn't load this invoice."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const changeStatus = async (status) => {
    setUpdating(true);
    setError("");
    try {
      // Sends the whole invoice back with only `status` swapped - the
      // backend has no partial-update endpoint, and the same server-side
      // reconciliation (paid -> linked income transaction / inventory
      // deduction) that runs on desktop's edit-dialog PUT runs here too.
      const { data } = await api.put(`/invoices/${id}`, { ...invoice, status });
      setInvoice(data);
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't update the status.");
    } finally {
      setUpdating(false);
    }
  };

  const exportPdf = async () => {
    setExporting(true);
    setError("");
    try {
      const { data } = await api.get(`/invoices/${id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError("Couldn't export this invoice as a PDF.");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="screen screen-narrow">
        <div className="top-row">
          <div className="top-row-left">
            <BackButton to="/invoices" />
            <Brand compact />
          </div>
        </div>
        <p className="subtitle">Loading…</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="screen screen-narrow">
        <div className="top-row">
          <div className="top-row-left">
            <BackButton to="/invoices" />
            <Brand compact />
          </div>
        </div>
        <p className="error-text">{error || "Invoice not found."}</p>
      </div>
    );
  }

  const otherStatuses = STATUSES.filter((s) => s !== invoice.status);

  return (
    <div className="screen screen-narrow">
      <div className="top-row">
        <div className="top-row-left">
          <BackButton to="/invoices" />
          <Brand compact />
        </div>
        <button type="button" className="icon-btn" aria-label="Export as PDF" title="Export as PDF" disabled={exporting} onClick={exportPdf}>
          <DownloadSimple size={18} />
        </button>
      </div>
      <div className="eyebrow">Invoice</div>
      <h2 className="heading">{invoice.invoice_number}</h2>
      <p className="subtitle">
        <span className={`status-badge status-badge-${invoice.status}`}>{invoice.status}</span>
      </p>

      <div className="card">
        <div className="list-title">{invoice.client_name}</div>
        {invoice.client_email && <div className="list-meta">{invoice.client_email}</div>}
        {invoice.client_address && <div className="list-meta">{invoice.client_address}</div>}
        <div className="list-meta" style={{ marginTop: "0.5rem" }}>
          Issued {fmtDate(invoice.issue_date)} · Due {fmtDate(invoice.due_date)}
        </div>

        <div style={{ marginTop: "1rem" }}>
          {(invoice.items || []).map((it, idx) => (
            <div key={idx} className="totals-row" style={{ color: "hsl(var(--foreground))" }}>
              <span>
                {it.description} × {it.quantity}
              </span>
              <span>{fmt(it.quantity * it.unit_price, invoice.currency)}</span>
            </div>
          ))}
        </div>

        <div className="totals-box" style={{ marginTop: "1rem" }}>
          <div className="totals-row">
            <span>Subtotal</span>
            <span>{fmt(invoice.subtotal, invoice.currency)}</span>
          </div>
          <div className="totals-row">
            <span>Tax</span>
            <span>{fmt(invoice.tax, invoice.currency)}</span>
          </div>
          <div className="totals-row-bold">
            <span>Total</span>
            <span>{fmt(invoice.total, invoice.currency)}</span>
          </div>
        </div>

        {invoice.notes && <p className="subtitle" style={{ marginTop: "1rem" }}>{invoice.notes}</p>}
      </div>

      <div className="form" style={{ marginTop: "1.5rem" }}>
        {error && <p className="error-text">{error}</p>}
        {otherStatuses.map((s) => (
          <button
            key={s}
            type="button"
            className={s === "paid" ? "btn-primary" : "btn-outline"}
            disabled={updating}
            onClick={() => changeStatus(s)}
          >
            Mark as {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}
