import { useEffect, useRef, useState } from "react";
import { CheckCircle, PaperPlaneTilt, Paperclip, File as FileIcon, X } from "@phosphor-icons/react";
import api from "../lib/api";
import { toast } from "../lib/toast";

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

function timeLabel(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function Attachment({ message }) {
  if (!message.attachment_data) return null;
  const src = `data:${message.attachment_content_type};base64,${message.attachment_data}`;
  const isImage = message.attachment_content_type?.startsWith("image/");
  return (
    <div style={{ marginTop: message.body ? "0.5rem" : 0 }}>
      {isImage ? (
        <a href={src} target="_blank" rel="noreferrer">
          <img src={src} alt={message.attachment_filename} style={{ maxWidth: "100%", maxHeight: "12rem", borderRadius: "0.4rem", border: "1px solid hsl(var(--border))" }} />
        </a>
      ) : (
        <a
          href={src}
          download={message.attachment_filename}
          style={{ display: "flex", alignItems: "center", gap: "0.4rem", borderRadius: "0.4rem", border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", padding: "0.4rem 0.6rem", fontSize: "0.75rem", textDecoration: "none", color: "inherit" }}
        >
          <FileIcon size={16} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message.attachment_filename}</span>
        </a>
      )}
    </div>
  );
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
          {last.sender === "admin" ? "You: " : ""}{last.body || `📎 ${last.attachment_filename}`}
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
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const fileInputRef = useRef(null);

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
    setPendingAttachment(null);
    api.get(`/admin/support/threads/${threadId}/messages`).then(({ data }) => {
      setDetail(data);
      // Clear this thread's unread dot in the list without a full reload.
      setThreads((prev) => prev.map((t) => (t.thread_id === threadId ? { ...t, unread_by_admin: false } : t)));
    }).catch((err) => setDetailError(err.response?.data?.detail || "Failed to load conversation"));
  };

  const pickFile = () => fileInputRef.current?.click();

  const onFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
      toast.error("Attachments must be a PNG, JPEG, WEBP, GIF, or PDF file");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error("Attachment must be smaller than 5MB");
      return;
    }
    setUploadingAttachment(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post("/admin/support/attachments", formData);
      setPendingAttachment(data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to upload attachment");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if ((!text && !pendingAttachment) || !selectedId) return;
    setSending(true);
    try {
      const payload = { body: text, ...(pendingAttachment || {}) };
      const { data } = await api.post(`/admin/support/threads/${selectedId}/messages`, payload);
      setDetail((prev) => ({ ...prev, messages: [...prev.messages, data] }));
      setBody("");
      setPendingAttachment(null);
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
                        {m.body && <div style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>{m.body}</div>}
                        <Attachment message={m} />
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={send} style={{ borderTop: "1px solid hsl(var(--border))", padding: "0.75rem 1rem" }}>
                {pendingAttachment && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", borderRadius: "0.4rem", border: "1px solid hsl(var(--border))", background: "hsl(var(--secondary))", padding: "0.35rem 0.6rem", fontSize: "0.75rem", marginBottom: "0.5rem" }}>
                    <FileIcon size={14} />
                    <span style={{ maxWidth: "12rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pendingAttachment.attachment_filename}</span>
                    <button type="button" onClick={() => setPendingAttachment(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
                      <X size={14} />
                    </button>
                  </div>
                )}
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
                  <input ref={fileInputRef} type="file" accept={ALLOWED_ATTACHMENT_TYPES.join(",")} style={{ display: "none" }} onChange={onFileSelected} />
                  <button type="button" className="btn btn-outline" onClick={pickFile} disabled={uploadingAttachment} style={{ padding: "0.5rem" }}>
                    <Paperclip size={16} />
                  </button>
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
                  <button type="submit" className="btn btn-primary" disabled={sending || uploadingAttachment || (!body.trim() && !pendingAttachment)}>
                    <PaperPlaneTilt size={14} /> Send
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
