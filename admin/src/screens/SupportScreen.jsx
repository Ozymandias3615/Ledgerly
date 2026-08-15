import { useEffect, useState } from "react";
import { CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react";
import api from "../lib/api";
import { toast } from "../lib/toast";

function timeLabel(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function ThreadRow({ thread, active, onClick }) {
  const last = thread.last_message;
  return (
    <div
      className="clickable"
      onClick={onClick}
      style={{
        padding: "0.75rem 1rem",
        borderBottom: "1px solid hsl(var(--border))",
        background: active ? "hsl(var(--secondary))" : "transparent",
        cursor: "pointer",
      }}
    >
      <div className="row-between">
        <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{thread.subject || thread.user_name || thread.user_email}</span>
        {thread.unread_by_admin && <span style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: "hsl(var(--destructive))" }} />}
      </div>
      <div className="muted" style={{ fontSize: "0.75rem" }}>{thread.user_name || thread.user_email} · {thread.user_email}</div>
      {last && (
        <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {last.sender === "admin" ? "You: " : ""}{last.body}
        </div>
      )}
      <div className="row-between" style={{ marginTop: "0.25rem" }}>
        <span className="badge">{thread.status}</span>
        <span className="muted" style={{ fontSize: "0.7rem" }}>{timeLabel(thread.updated_at)}</span>
      </div>
    </div>
  );
}

const STATUS_FILTERS = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

export default function SupportScreen() {
  const [threads, setThreads] = useState(null);
  const [threadsError, setThreadsError] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const loadThreads = (status = statusFilter) => {
    setThreadsError("");
    api.get("/admin/support/threads", { params: status === "all" ? {} : { status } })
      .then(({ data }) => setThreads(data))
      .catch((err) => setThreadsError(err.response?.data?.detail || "Failed to load conversations"));
  };
  useEffect(() => { loadThreads(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changeFilter = (status) => {
    setStatusFilter(status);
    setSelectedId(null);
    setDetail(null);
    loadThreads(status);
  };

  const openThread = (threadId) => {
    setSelectedId(threadId);
    setDetail(null);
    setDetailError("");
    api.get(`/admin/support/threads/${threadId}/messages`).then(({ data }) => {
      setDetail(data);
      // Clear this thread's unread dot in the list without a full reload.
      setThreads((prev) => prev.map((t) => (t.thread_id === threadId ? { ...t, unread_by_admin: false } : t)));
    }).catch((err) => setDetailError(err.response?.data?.detail || "Failed to load conversation"));
  };

  const send = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || !selectedId) return;
    setSending(true);
    try {
      const { data } = await api.post(`/admin/support/threads/${selectedId}/messages`, { body: text });
      setDetail((prev) => ({ ...prev, messages: [...prev.messages, data] }));
      setBody("");
      loadThreads();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  const resolve = async () => {
    if (!selectedId) return;
    try {
      await api.post(`/admin/support/threads/${selectedId}/resolve`);
      toast.success("Marked resolved");
      loadThreads();
      // Resolved threads drop out of the "Open" filter, so the detail pane
      // would otherwise keep showing a thread that's no longer in the list.
      if (statusFilter === "open") {
        setSelectedId(null);
        setDetail(null);
      } else {
        setDetail((prev) => (prev ? { ...prev, thread: { ...prev.thread, status: "resolved" } } : prev));
      }
    } catch {
      toast.error("Failed to resolve thread");
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Internal</div>
        <h1 className="page-title">Support</h1>
        <p className="page-subtitle">Conversations started by users from inside the app</p>
      </div>

      <div className="card" style={{ display: "flex", height: "70vh", overflow: "hidden" }}>
        <div style={{ width: "20rem", flexShrink: 0, borderRight: "1px solid hsl(var(--border))", overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0.75rem", borderBottom: "1px solid hsl(var(--border))" }}>
            <div className="filter-tabs">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`filter-tab${statusFilter === f.key ? " active" : ""}`}
                  onClick={() => changeFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {threadsError ? (
            <p className="muted" style={{ padding: "1rem", color: "hsl(var(--destructive))" }}>{threadsError}</p>
          ) : !threads ? (
            <p className="muted" style={{ padding: "1rem" }}>Loading...</p>
          ) : threads.length === 0 ? (
            <p className="muted" style={{ padding: "1rem" }}>No {statusFilter === "all" ? "" : statusFilter + " "}conversations.</p>
          ) : (
            threads.map((t) => (
              <ThreadRow key={t.thread_id} thread={t} active={t.thread_id === selectedId} onClick={() => openThread(t.thread_id)} />
            ))
          )}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {!selectedId ? (
            <div className="muted" style={{ margin: "auto" }}>Select a conversation</div>
          ) : detailError ? (
            <p className="muted" style={{ padding: "1rem", color: "hsl(var(--destructive))" }}>{detailError}</p>
          ) : !detail ? (
            <p className="muted" style={{ padding: "1rem" }}>Loading...</p>
          ) : (
            <>
              <div className="row-between" style={{ padding: "0.75rem 1rem", borderBottom: "1px solid hsl(var(--border))" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{detail.thread.subject || detail.thread.user_name || detail.thread.user_email}</div>
                  <div className="muted" style={{ fontSize: "0.75rem" }}>{detail.thread.user_name || detail.thread.user_email} · {detail.thread.user_email}</div>
                </div>
                {detail.thread.status === "resolved" ? (
                  <span className="badge">resolved</span>
                ) : (
                  <button className="btn btn-outline" onClick={resolve}><CheckCircle size={14} /> Mark resolved</button>
                )}
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {detail.messages.length === 0 ? (
                  <p className="muted">No messages yet.</p>
                ) : (
                  detail.messages.map((m) => (
                    <div key={m.message_id} style={{ display: "flex", justifyContent: m.sender === "admin" ? "flex-end" : "flex-start" }}>
                      <div style={{
                        maxWidth: "70%", borderRadius: "0.5rem", padding: "0.5rem 0.75rem",
                        background: m.sender === "admin" ? "hsl(var(--primary))" : "hsl(var(--secondary))",
                        color: m.sender === "admin" ? "hsl(var(--primary-foreground))" : "hsl(var(--secondary-foreground))",
                      }}>
                        <div style={{ fontSize: "0.7rem", opacity: 0.7, marginBottom: "0.15rem" }}>{m.sender_name} · {timeLabel(m.created_at)}</div>
                        <div style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>{m.body}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={send} style={{ borderTop: "1px solid hsl(var(--border))", padding: "0.75rem 1rem", display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
                <textarea
                  className="input"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); } }}
                  placeholder="Reply..."
                  rows={2}
                  maxLength={4000}
                  style={{ resize: "none" }}
                />
                <button type="submit" className="btn btn-primary" disabled={sending || !body.trim()}>
                  <PaperPlaneTilt size={14} /> Send
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
