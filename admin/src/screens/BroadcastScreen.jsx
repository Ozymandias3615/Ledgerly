import { useState } from "react";
import { Megaphone } from "@phosphor-icons/react";
import api from "../lib/api";
import { toast } from "../lib/toast";
import ConfirmModal from "../components/ConfirmModal";

export default function BroadcastScreen() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [pendingSend, setPendingSend] = useState(false);
  const [sending, setSending] = useState(false);

  const confirmSend = async () => {
    setPendingSend(false);
    setSending(true);
    try {
      const { data } = await api.post("/admin/broadcast", { title, message, link: link || null });
      toast.success(`Sent to ${data.businesses_notified} business(es), ${data.users_notified} account(s), ${data.push_sent} push notification(s)`);
      setTitle("");
      setMessage("");
      setLink("");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to send broadcast");
    } finally {
      setSending(false);
    }
  };

  const canSend = title.trim().length > 0;

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Internal</div>
        <h1 className="page-title">Broadcast</h1>
        <p className="page-subtitle">Send an announcement to every user's notification bell, plus a push to any subscribed device</p>
      </div>

      <div className="card card-pad" style={{ maxWidth: "32rem" }}>
        <label className="field-label">Title</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Scheduled maintenance tonight"
          maxLength={200}
          style={{ marginBottom: "0.75rem" }}
        />
        <label className="field-label">Message (optional)</label>
        <textarea
          className="input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="More detail, if useful"
          maxLength={1000}
          rows={4}
          style={{ marginBottom: "0.75rem", resize: "vertical" }}
        />
        <label className="field-label">Link (optional)</label>
        <input
          className="input"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="/settings"
          style={{ marginBottom: "1rem" }}
        />
        <button className="btn btn-primary" disabled={!canSend || sending} onClick={() => setPendingSend(true)}>
          <Megaphone size={14} /> {sending ? "Sending…" : "Send broadcast"}
        </button>
      </div>

      {pendingSend && (
        <ConfirmModal
          title="Send this to every user?"
          description={`"${title}" will appear in every business's and every personal account's notification bell right away. This can't be recalled once sent.`}
          confirmLabel="Send broadcast"
          onConfirm={confirmSend}
          onClose={() => setPendingSend(false)}
        />
      )}
    </div>
  );
}
