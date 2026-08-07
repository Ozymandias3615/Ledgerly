import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus } from "@phosphor-icons/react";
import api from "../lib/api";
import { fmtDate, fmtAmount } from "../lib/format";
import { flushQueuedReceipts, listQueuedReceipts, removeQueuedReceipt } from "../lib/offlineQueue";
import Brand from "../components/Brand";
import AppShell from "../components/AppShell";

export default function ReceiptsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const justSubmitted = Boolean(location.state?.justSubmitted);
  const queuedOffline = Boolean(location.state?.queuedOffline);
  const [receipts, setReceipts] = useState(null);
  const [pending, setPending] = useState([]);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loadReceipts = () =>
    api
      .get("/transactions", { params: { has_receipt: true } })
      .then(({ data }) => setReceipts(data))
      .catch((err) => setError(err.response?.data?.detail || "Couldn't load your receipts."));

  useEffect(() => {
    let cancelled = false;
    loadReceipts();

    // Picks up anything captured while offline, both on first load and
    // whenever the connection comes back - there's no Background Sync
    // fallback (iOS Safari doesn't support it), so this only ever runs while
    // the app is actually open.
    const sync = () => {
      flushQueuedReceipts(api).then(({ synced }) => {
        if (cancelled) return;
        listQueuedReceipts().then((items) => {
          if (!cancelled) setPending(items);
        });
        if (synced > 0) loadReceipts();
      });
    };
    sync();
    window.addEventListener("online", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("online", sync);
    };
  }, []);

  const handleDelete = async (receipt) => {
    if (!window.confirm("Delete this receipt? This can't be undone.")) return;
    setDeletingId(receipt.id);
    try {
      if (receipt.pending) {
        await removeQueuedReceipt(receipt.id);
        setPending((prev) => prev.filter((r) => r.localId !== receipt.id));
      } else {
        await api.delete(`/transactions/${receipt.id}`);
        setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
      }
      if (preview?.id === receipt.id) setPreview(null);
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't delete this receipt.");
    } finally {
      setDeletingId(null);
    }
  };

  const items = [...pending.map((r) => ({ ...r, id: r.localId, pending: true })), ...(receipts || [])];

  return (
    <AppShell>
      <div className="screen screen-narrow">
        <div className="top-row">
          <Brand compact />
          <button type="button" className="icon-btn" aria-label="Capture a receipt" title="Capture a receipt" onClick={() => navigate("/capture")}>
            <Plus size={18} />
          </button>
        </div>
        <div className="eyebrow">History</div>
        <h2 className="heading">Your receipts</h2>
        <p className="subtitle">Everything you've captured, saved as expenses.</p>

        {justSubmitted && <div className="banner banner-success">Expense saved.</div>}
        {queuedOffline && (
          <div className="banner banner-warning">Saved offline — will upload once you're back online.</div>
        )}
        {error && <p className="error-text">{error}</p>}

        {receipts === null && pending.length === 0 && !error && (
          <p className="subtitle thinking">
            <span className="thinking-dots"><span /><span /><span /></span>
            Loading
          </p>
        )}

        {receipts !== null && items.length === 0 && (
          <p className="subtitle">No receipts yet. Tap + to capture your first one.</p>
        )}

        {items.length > 0 && (
          <div className="list">
            {items.map((r) => (
              <div className="list-card" key={r.id}>
                <button
                  type="button"
                  className="list-thumb-btn"
                  onClick={() => setPreview(r)}
                  aria-label="View full receipt"
                >
                  {r.receipt_image ? (
                    <img
                      src={`data:${r.receipt_content_type || "image/jpeg"};base64,${r.receipt_image}`}
                      alt={r.description || "Receipt"}
                      className="list-thumb"
                    />
                  ) : (
                    <div className="list-thumb list-thumb-empty" />
                  )}
                </button>
                <div className="list-info">
                  <div className="list-title">{r.description || "Receipt"}</div>
                  <div className="list-meta">
                    {r.pending && <span className="status-badge status-badge-draft" style={{ marginRight: "0.375rem" }}>Pending sync</span>}
                    {fmtDate(r.date)}
                    {r.category ? ` · ${r.category}` : ""}
                  </div>
                </div>
                <div className="list-amount">{fmtAmount(r.amount, r.currency)}</div>
                <button
                  type="button"
                  className="icon-btn list-delete-btn"
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
                  <div className="list-title">{preview.description || "Receipt"}</div>
                  <div className="list-meta">
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
    </AppShell>
  );
}
