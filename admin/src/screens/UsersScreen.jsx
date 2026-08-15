import { useEffect, useState } from "react";
import { Key, MagnifyingGlass, PencilSimple, SignOut, Trash } from "@phosphor-icons/react";
import api from "../lib/api";
import { toast } from "../lib/toast";
import Modal from "../components/Modal";
import ConfirmModal from "../components/ConfirmModal";
import ResetPasswordResultModal from "../components/ResetPasswordResultModal";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatRelative(iso) {
  if (!iso) return "Never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

function UserDetailModal({ userId, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingReset, setPendingReset] = useState(false);
  const [resetPassword, setResetPassword] = useState(null);

  useEffect(() => {
    api.get(`/admin/users/${userId}`).then(({ data }) => {
      setDetail(data);
      setName(data.user.name || "");
      setEmail(data.user.email || "");
    });
  }, [userId]);

  const saveDetails = async () => {
    try {
      await api.put(`/admin/users/${userId}`, { name, email });
      toast.success("Account updated");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to update account");
    }
  };

  const revokeSessions = async () => {
    try {
      const { data } = await api.post(`/admin/users/${userId}/revoke-sessions`);
      toast.success(`Revoked ${data.revoked} session(s)`);
    } catch {
      toast.error("Failed to revoke sessions");
    }
  };

  const confirmReset = async () => {
    setPendingReset(false);
    try {
      const { data } = await api.post(`/admin/users/${userId}/reset-password`);
      setResetPassword(data.temporary_password);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to reset password");
    }
  };

  const confirmDelete = async () => {
    setPendingDelete(false);
    try {
      await api.delete(`/admin/users/${userId}`);
      toast.success("Account deleted");
      onClose();
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete account");
    }
  };

  return (
    <Modal title="User detail" onClose={onClose}>
      {!detail ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
          <label className="field-label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: "0.75rem" }} />
          <label className="field-label">Email</label>
          <div className="field-row">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn btn-outline" onClick={saveDetails}><PencilSimple size={14} /> Save</button>
          </div>
          <p className="muted" style={{ marginTop: "0.5rem", marginBottom: 0 }}>{detail.user.auth_provider} · Joined {formatDate(detail.user.created_at)}</p>
          <p className="muted" style={{ marginTop: "0.15rem", fontSize: "0.75rem" }}>Last active: {formatRelative(detail.last_active)}</p>

          <div className="modal-section">
            <div className="modal-section-label">Businesses</div>
            {detail.memberships.length === 0 ? (
              <p className="muted">No business memberships.</p>
            ) : (
              detail.memberships.map((m) => (
                <div key={m.membership_id} className="list-row">
                  <span>{m.business_name || m.business_id}</span>
                  <span className="badge">{m.role}</span>
                </div>
              ))
            )}
          </div>

          <div className="modal-section">
            <div className="modal-section-label">Ledgerly Personal</div>
            <div className="stat-mini-grid">
              <div><div className="stat-mini-value">{detail.personal_counts.transactions}</div><div className="stat-mini-label">Txns</div></div>
              <div><div className="stat-mini-value">{detail.personal_counts.budgets}</div><div className="stat-mini-label">Budgets</div></div>
              <div><div className="stat-mini-value">{detail.personal_counts.bills}</div><div className="stat-mini-label">Bills</div></div>
              <div><div className="stat-mini-value">{detail.personal_counts.goals}</div><div className="stat-mini-label">Goals</div></div>
            </div>
          </div>

          <div className="modal-section row-between">
            <span className="muted">{detail.active_sessions} active session(s)</span>
            <button className="btn btn-outline" onClick={revokeSessions}><SignOut size={14} /> Revoke all sessions</button>
          </div>

          <div className="modal-section row-between">
            <span className="muted">Locked out? Set a temporary password for them.</span>
            <button className="btn btn-outline" onClick={() => setPendingReset(true)}><Key size={14} /> Reset password</button>
          </div>

          <div className="divider">
            <button className="btn btn-destructive" onClick={() => setPendingDelete(true)}><Trash size={14} /> Delete account</button>
          </div>
        </>
      )}
      {pendingReset && (
        <ConfirmModal
          title="Reset this user's password?"
          description="Generates a new temporary password and signs them out of every active session. Use this when a user reports being locked out."
          confirmLabel="Reset password"
          destructive={false}
          onConfirm={confirmReset}
          onClose={() => setPendingReset(false)}
        />
      )}
      {resetPassword && (
        <ResetPasswordResultModal email={detail.user.email} password={resetPassword} onClose={() => setResetPassword(null)} />
      )}
      {pendingDelete && (
        <ConfirmModal
          title="Delete this account?"
          description="Permanently deletes the account and, if they solely own a business, that business's data too. This cannot be undone."
          confirmLabel="Delete account"
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(false)}
        />
      )}
    </Modal>
  );
}

export default function UsersScreen() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  const load = () => {
    setLoading(true);
    api.get("/admin/users").then(({ data }) => {
      setUsers(data.users);
      setLoading(false);
    });
  };
  useEffect(load, []);

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return u.email?.toLowerCase().includes(q) || u.name?.toLowerCase().includes(q) || u.business_name?.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Internal</div>
        <h1 className="page-title">Admin</h1>
        <p className="page-subtitle">Manage users and businesses, and check on system health</p>
      </div>

      <div className="toolbar">
        <span className="muted">{loading ? "Loading..." : `${filtered.length} of ${users.length} account(s)`}</span>
        <div className="search-wrap">
          <MagnifyingGlass size={16} className="search-icon" />
          <input className="input" placeholder="Search by name, email, business" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Business</th><th>Sign-in method</th><th>Joined</th><th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="empty-row">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="empty-row">No users found.</td></tr>
            ) : filtered.map((u) => (
              <tr key={u.user_id} className="clickable" onClick={() => setSelected(u.user_id)}>
                <td>{u.name || "—"}</td>
                <td className="muted">{u.email}</td>
                <td className="muted">{u.business_name || "—"}</td>
                <td><span className="badge">{u.auth_provider || "unknown"}</span></td>
                <td className="muted">{formatDate(u.created_at)}</td>
                <td className="muted">{formatRelative(u.last_active)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && <UserDetailModal userId={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}
