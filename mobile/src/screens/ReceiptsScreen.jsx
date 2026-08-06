import { useEffect, useState } from "react";
import api from "../lib/api";
import Brand from "../components/Brand";
import ThemeToggle from "../components/ThemeToggle";
import BackButton from "../components/BackButton";

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtAmount(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
  } catch {
    return `${currency || ""} ${amount}`.trim();
  }
}

export default function ReceiptsScreen() {
  const [receipts, setReceipts] = useState(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/transactions", { params: { has_receipt: true } })
      .then(({ data }) => {
        if (!cancelled) setReceipts(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.detail || "Couldn't load your receipts.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = async (receipt) => {
    if (!window.confirm("Delete this receipt? This can't be undone.")) return;
    setDeletingId(receipt.id);
    try {
      await api.delete(`/transactions/${receipt.id}`);
      setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
      if (preview?.id === receipt.id) setPreview(null);
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't delete this receipt.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="screen screen-narrow">
      <div className="top-row">
        <div className="top-row-left">
          <BackButton to="/capture" />
          <Brand compact />
        </div>
        <ThemeToggle />
      </div>
      <div className="eyebrow">History</div>
      <h2 className="heading">Your receipts</h2>
      <p className="subtitle">Everything you've captured, saved as expenses.</p>

      {error && <p className="error-text">{error}</p>}

      {receipts === null && !error && <p className="subtitle">Loading…</p>}

      {receipts && receipts.length === 0 && (
        <p className="subtitle">No receipts yet. Capture your first one from the home screen.</p>
      )}

      {receipts && receipts.length > 0 && (
        <div className="receipt-list">
          {receipts.map((r) => (
            <div className="receipt-card" key={r.id}>
              <button
                type="button"
                className="receipt-thumb-btn"
                onClick={() => setPreview(r)}
                aria-label="View full receipt"
              >
                {r.receipt_image ? (
                  <img
                    src={`data:${r.receipt_content_type || "image/jpeg"};base64,${r.receipt_image}`}
                    alt={r.description || "Receipt"}
                    className="receipt-thumb"
                  />
                ) : (
                  <div className="receipt-thumb receipt-thumb-empty" />
                )}
              </button>
              <div className="receipt-info">
                <div className="receipt-title">{r.description || "Receipt"}</div>
                <div className="receipt-meta">
                  {fmtDate(r.date)}
                  {r.category ? ` · ${r.category}` : ""}
                </div>
              </div>
              <div className="receipt-amount">{fmtAmount(r.amount, r.currency)}</div>
              <button
                type="button"
                className="icon-btn receipt-delete-btn"
                aria-label="Delete receipt"
                disabled={deletingId === r.id}
                onClick={() => handleDelete(r)}
              >
                <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="receipt-title">{preview.description || "Receipt"}</div>
                <div className="receipt-meta">
                  {fmtDate(preview.date)} · {fmtAmount(preview.amount, preview.currency)}
                </div>
              </div>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setPreview(null)}>
                <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                  <line x1="200" y1="56" x2="56" y2="200" />
                  <line x1="200" y1="200" x2="56" y2="56" />
                </svg>
              </button>
            </div>
            {preview.receipt_image && (
              <img
                src={`data:${preview.receipt_content_type || "image/jpeg"};base64,${preview.receipt_image}`}
                alt={preview.description || "Receipt"}
                className="modal-image"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
