import { useState } from "react";
import api from "../lib/api";
import { toast } from "../lib/toast";
import Modal from "./Modal";

export default function SetPasswordModal({ onClose }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/admin/set-password", { password });
      toast.success("Password set — you can now sign in with email + password too");
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to set password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Set a password" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Adds email + password as a second way into this admin panel, alongside Google sign-in.
      </p>
      <form onSubmit={submit}>
        <label className="field-label">New password</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          style={{ marginBottom: "0.75rem" }}
        />
        <label className="field-label">Confirm password</label>
        <input
          className="input"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          style={{ marginBottom: "1rem" }}
        />
        {error && <p className="error-text">{error}</p>}
        <div className="field-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Set password"}</button>
        </div>
      </form>
    </Modal>
  );
}
