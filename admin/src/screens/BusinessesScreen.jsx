import { useEffect, useState } from "react";
import { ArrowClockwise, CaretDown, CaretRight, Crown, X } from "@phosphor-icons/react";
import api from "../lib/api";
import { toast } from "../lib/toast";
import Modal from "../components/Modal";
import ConfirmModal from "../components/ConfirmModal";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function TransactionRow({ t }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid hsl(var(--border))" }}>
      <div className="list-row" style={{ cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.35rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {open ? <CaretDown size={12} /> : <CaretRight size={12} />} {t.description || t.category}
        </span>
        <span className={t.type === "income" ? "income" : "expense"}>
          {t.type === "income" ? "+" : "-"}{t.amount.toFixed(2)} {t.currency}
        </span>
      </div>
      {open && (
        <div style={{ fontSize: "0.8rem", padding: "0 0 0.6rem 1.1rem", color: "hsl(var(--muted-foreground))" }}>
          <div>Category: {t.category}</div>
          <div>Date: {t.date}</div>
          {t.tax_amount > 0 && <div>Tax: {t.tax_amount.toFixed(2)} {t.currency}</div>}
          {t.vendor_id && <div>Vendor ID: {t.vendor_id}</div>}
          {t.invoice_id && <div>Linked invoice ID: {t.invoice_id}</div>}
          {t.has_receipt && <div>Has receipt image</div>}
          <div>Created: {formatDate(t.created_at)}</div>
        </div>
      )}
    </div>
  );
}

function InvoiceRow({ inv }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid hsl(var(--border))" }}>
      <div className="list-row" style={{ cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          {open ? <CaretDown size={12} /> : <CaretRight size={12} />} {inv.invoice_number} · {inv.client_name}
        </span>
        <span className="badge">{inv.status}</span>
      </div>
      {open && (
        <div style={{ fontSize: "0.8rem", padding: "0 0 0.6rem 1.1rem", color: "hsl(var(--muted-foreground))" }}>
          <div>Issued {inv.issue_date} · Due {inv.due_date}</div>
          <div>Subtotal {inv.subtotal?.toFixed(2)} + tax {inv.tax?.toFixed(2)} = total {inv.total?.toFixed(2)} {inv.currency}</div>
          {inv.client_email && <div>Client email: {inv.client_email}</div>}
          {inv.notes && <div>Notes: {inv.notes}</div>}
          <div style={{ marginTop: "0.35rem" }}>
            {inv.items?.map((it, i) => (
              <div key={i}>{it.quantity} × {it.description} @ {it.unit_price.toFixed(2)}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function inviteStatus(inv) {
  if (inv.redeemed_at) return "used";
  if (new Date(inv.expires_at) < new Date()) return "expired";
  return "pending";
}

function BusinessDetailModal({ businessId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [pendingOwner, setPendingOwner] = useState(null);

  const load = () => {
    api.get(`/admin/businesses/${businessId}`).then(({ data }) => setDetail(data));
  };
  useEffect(load, [businessId]);

  const resetAiQuota = async () => {
    try {
      await api.post(`/admin/businesses/${businessId}/reset-ai-quota`);
      toast.success("AI quota reset for today");
    } catch {
      toast.error("Failed to reset quota");
    }
  };

  const confirmTransfer = async () => {
    const target = pendingOwner;
    setPendingOwner(null);
    try {
      await api.post(`/admin/businesses/${businessId}/transfer-ownership`, { new_owner_user_id: target.user_id });
      toast.success(`${target.name || target.email} is now the owner`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to transfer ownership");
    }
  };

  const revokeInvite = async (code) => {
    try {
      await api.delete(`/admin/invites/${code}`);
      toast.success("Invite revoked");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to revoke invite");
    }
  };

  return (
    <Modal title={detail?.business?.name || "Business detail"} onClose={onClose}>
      {!detail ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
          <div className="row-between">
            <span className="muted">Currency: {detail.business.currency} · Created {formatDate(detail.business.created_at)}</span>
            <button className="btn btn-outline" onClick={resetAiQuota}><ArrowClockwise size={14} /> Reset AI quota</button>
          </div>

          <div className="modal-section">
            <div className="modal-section-label">Members</div>
            {detail.members.map((m) => (
              <div key={m.membership_id} className="list-row">
                <span>{m.name || m.email || m.user_id}</span>
                <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span className="badge">{m.role}</span>
                  {m.role !== "owner" && (
                    <button className="btn btn-outline" style={{ padding: "0.2rem 0.5rem" }} onClick={() => setPendingOwner(m)} title="Make owner">
                      <Crown size={13} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="modal-section">
            <div className="modal-section-label">Recent transactions ({detail.counts.transactions} total)</div>
            <div className="scroll-list">
              {detail.recent_transactions.length === 0 ? (
                <p className="muted">None yet.</p>
              ) : detail.recent_transactions.slice(0, 10).map((t) => <TransactionRow key={t.id} t={t} />)}
            </div>
          </div>

          <div className="modal-section">
            <div className="modal-section-label">Recent invoices ({detail.counts.invoices} total)</div>
            <div className="scroll-list">
              {detail.recent_invoices.length === 0 ? (
                <p className="muted">None yet.</p>
              ) : detail.recent_invoices.slice(0, 10).map((inv) => <InvoiceRow key={inv.id} inv={inv} />)}
            </div>
          </div>

          <div className="modal-section">
            <div className="modal-section-label">Invites</div>
            {detail.invites.length === 0 ? (
              <p className="muted">No invites.</p>
            ) : detail.invites.map((inv) => {
              const status = inviteStatus(inv);
              return (
                <div key={inv.invite_id} className="list-row">
                  <span>{inv.code} · <span className="badge">{inv.role}</span></span>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span className="muted" style={{ fontSize: "0.75rem" }}>{status}</span>
                    {status === "pending" && (
                      <button className="btn btn-outline" style={{ padding: "0.2rem 0.5rem" }} onClick={() => revokeInvite(inv.code)} title="Revoke">
                        <X size={13} />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="divider" style={{ display: "flex", gap: "1.5rem", fontSize: "0.875rem" }}>
            <div><strong>{detail.inventory.length}</strong> inventory items</div>
            <div><strong>{detail.employees.length}</strong> employees</div>
          </div>
        </>
      )}
      {pendingOwner && (
        <ConfirmModal
          title={`Make ${pendingOwner.name || pendingOwner.email} the owner?`}
          description="The current owner is demoted to admin. This changes who has full control of the business."
          confirmLabel="Transfer ownership"
          onConfirm={confirmTransfer}
          onClose={() => setPendingOwner(null)}
        />
      )}
    </Modal>
  );
}

export default function BusinessesScreen() {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.get("/admin/businesses").then(({ data }) => {
      setBusinesses(data.businesses);
      setLoading(false);
    });
  }, []);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Internal</div>
        <h1 className="page-title">Businesses</h1>
        <p className="page-subtitle">{loading ? "Loading..." : `${businesses.length} business(es)`}</p>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Owner</th><th>Members</th><th>Transactions</th><th>Invoices</th><th>Created</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="empty-row">Loading...</td></tr>
            ) : businesses.length === 0 ? (
              <tr><td colSpan={6} className="empty-row">No businesses found.</td></tr>
            ) : businesses.map((b) => (
              <tr key={b.business_id} className="clickable" onClick={() => setSelected(b.business_id)}>
                <td>{b.name}</td>
                <td className="muted">{b.owner?.name || "—"}</td>
                <td className="muted">{b.member_count}</td>
                <td className="muted">{b.transaction_count}</td>
                <td className="muted">{b.invoice_count}</td>
                <td className="muted">{formatDate(b.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && <BusinessDetailModal businessId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
