import { useEffect, useState } from "react";
import api from "../lib/api";

function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const actionLabels = {
  set_own_password: "Set own password",
  update_user: "Updated user",
  revoke_sessions: "Revoked sessions",
  reset_password: "Reset password",
  delete_user: "Deleted account",
  reset_ai_quota: "Reset AI quota",
  transfer_ownership: "Transferred ownership",
  revoke_invite: "Revoked invite",
};

function describeDetails(entry) {
  const d = entry.details || {};
  switch (entry.action) {
    case "update_user":
      return `name: ${d.name}${d.email ? `, email: ${d.email}` : ""}`;
    case "revoke_sessions":
      return `${d.revoked} session(s)`;
    case "transfer_ownership":
      return `new owner: ${d.new_owner_email || d.new_owner_user_id}`;
    case "revoke_invite":
      return `role: ${d.role}`;
    default:
      return "";
  }
}

export default function AuditLogScreen() {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    api.get("/admin/audit-log").then(({ data }) => setEntries(data.entries));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Internal</div>
        <h1 className="page-title">Audit log</h1>
        <p className="page-subtitle">Every state-changing action taken from this admin panel</p>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr>
          </thead>
          <tbody>
            {!entries ? (
              <tr><td colSpan={5} className="empty-row">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} className="empty-row">No admin actions recorded yet.</td></tr>
            ) : entries.map((e) => (
              <tr key={e.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(e.timestamp)}</td>
                <td>{e.admin_name || e.admin_email}</td>
                <td><span className="badge">{actionLabels[e.action] || e.action}</span></td>
                <td className="muted">{e.target_label || e.target_id}</td>
                <td className="muted">{describeDetails(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
