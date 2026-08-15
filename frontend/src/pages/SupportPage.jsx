import React, { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatApiError } from "@/lib/utils_app";
import { PaperPlaneTilt, Plus, Paperclip, File as FileIcon, X } from "@phosphor-icons/react";
import { toast } from "sonner";

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
    <div className={message.body ? "mt-2" : ""}>
      {isImage ? (
        <a href={src} target="_blank" rel="noreferrer">
          <img src={src} alt={message.attachment_filename} className="max-w-full max-h-48 rounded-md border border-slate-200" />
        </a>
      ) : (
        <a
          href={src}
          download={message.attachment_filename}
          className="flex items-center gap-2 rounded-md border border-slate-200 bg-white/80 px-2.5 py-1.5 text-xs no-underline text-inherit hover:bg-white"
        >
          <FileIcon size={16} className="shrink-0" />
          <span className="truncate">{message.attachment_filename}</span>
        </a>
      )}
    </div>
  );
}

function ThreadRow({ thread, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-200 ${active ? "bg-slate-100" : "hover:bg-slate-50"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold truncate">{thread.subject || "Conversation"}</span>
        {thread.unread_by_user && <span className="shrink-0 h-2 w-2 rounded-full bg-red-500" />}
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className={`text-xs px-1.5 py-0.5 rounded ${thread.status === "resolved" ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>
          {thread.status}
        </span>
        <span className="text-xs text-slate-400">{timeLabel(thread.updated_at)}</span>
      </div>
    </button>
  );
}

export default function SupportPage() {
  const { user, refresh } = useAuth();
  const [threads, setThreads] = useState(null);
  const [threadsError, setThreadsError] = useState("");
  const [selectedId, setSelectedId] = useState(null); // thread_id, or "new"
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState(null); // { attachment_data, attachment_content_type, attachment_filename }
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  // Guards the initial auto-select-on-load below against a race with the
  // user clicking "New conversation" before the list finishes loading -
  // without this, the async .then() below runs with a stale closure over
  // selectedId (captured as null at mount) and silently overrides whatever
  // the user already picked.
  const autoSelectedRef = useRef(false);

  const loadThreads = () => {
    setThreadsError("");
    api.get("/support/threads")
      .then(({ data }) => {
        setThreads(data);
        if (!autoSelectedRef.current) {
          autoSelectedRef.current = true;
          if (data.length > 0) openThread(data[0].thread_id);
          else setSelectedId("new");
        }
      })
      .catch((err) => setThreadsError(formatApiError(err) || "Failed to load conversations"));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadThreads, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail]);

  const openThread = (threadId) => {
    setSelectedId(threadId);
    setDetail(null);
    setDetailError("");
    api.get(`/support/threads/${threadId}/messages`)
      .then(({ data }) => {
        setDetail(data);
        setThreads((prev) => prev && prev.map((t) => (t.thread_id === threadId ? { ...t, unread_by_user: false } : t)));
        if (user?.support_unread) refresh();
      })
      .catch((err) => setDetailError(formatApiError(err) || "Failed to load conversation"));
  };

  const startNew = () => {
    setSelectedId("new");
    setDetail(null);
    setDetailError("");
    setBody("");
    setPendingAttachment(null);
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
      const { data } = await api.post("/support/attachments", formData);
      setPendingAttachment(data);
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to upload attachment");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text && !pendingAttachment) return;
    setSending(true);
    try {
      const payload = { body: text, ...(pendingAttachment || {}) };
      if (selectedId === "new") {
        const { data } = await api.post("/support/threads", payload);
        setSelectedId(data.thread.thread_id);
        setDetail(data);
        setThreads((prev) => [data.thread, ...(prev || [])]);
      } else {
        const { data } = await api.post(`/support/threads/${selectedId}/messages`, payload);
        setDetail((prev) => ({ ...prev, messages: [...prev.messages, data] }));
        loadThreads();
      }
      setBody("");
      setPendingAttachment(null);
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const composing = selectedId === "new";
  const resolved = !composing && detail?.thread?.status === "resolved";

  return (
    <div className="p-8 h-full flex flex-col" data-testid="support-page">
      <div className="mb-6 shrink-0 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Support</div>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Contact us</h1>
          <div className="text-sm text-slate-500 mt-1">Start a new conversation, or continue an existing one - we'll reply here.</div>
        </div>
        <Button type="button" variant="outline" onClick={startNew} data-testid="support-new-thread-button">
          <Plus size={16} className="mr-2" /> New conversation
        </Button>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-slate-200 flex overflow-hidden bg-white">
        <div className="w-72 shrink-0 border-r border-slate-200 overflow-y-auto">
          {threadsError ? (
            <div className="p-4 text-sm text-red-600">{threadsError}</div>
          ) : !threads ? (
            <div className="p-4 text-sm text-slate-500">Loading...</div>
          ) : threads.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">No conversations yet.</div>
          ) : (
            threads.map((t) => (
              <ThreadRow key={t.thread_id} thread={t} active={t.thread_id === selectedId} onClick={() => openThread(t.thread_id)} />
            ))
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
            {composing ? (
              <div className="text-sm text-slate-500 text-center mt-8">
                Say hello below to start a new conversation.
              </div>
            ) : detailError ? (
              <div className="text-sm text-red-600">{detailError}</div>
            ) : !detail ? (
              <div className="text-sm text-slate-500">Loading...</div>
            ) : (
              detail.messages.map((m) => (
                <div key={m.message_id} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[70%] rounded-lg px-4 py-2 ${m.sender === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"}`}>
                    <div className="text-xs opacity-70 mb-1">{m.sender === "user" ? "You" : m.sender_name} · {timeLabel(m.created_at)}</div>
                    {m.body && <div className="text-sm whitespace-pre-wrap">{m.body}</div>}
                    <Attachment message={m} />
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {resolved ? (
            <div className="shrink-0 border-t border-slate-200 p-4 flex items-center justify-between gap-3 bg-slate-50">
              <span className="text-sm text-slate-500">This conversation was resolved.</span>
              <Button type="button" variant="outline" size="sm" onClick={startNew} data-testid="support-resolved-new-thread-button">
                <Plus size={14} className="mr-2" /> New conversation
              </Button>
            </div>
          ) : (
            <form onSubmit={send} className="shrink-0 border-t border-slate-200 p-4">
              {pendingAttachment && (
                <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
                  <FileIcon size={14} />
                  <span className="truncate max-w-[12rem]">{pendingAttachment.attachment_filename}</span>
                  <button type="button" onClick={() => setPendingAttachment(null)} data-testid="support-remove-attachment-button">
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="flex gap-2 items-end">
                <input ref={fileInputRef} type="file" accept={ALLOWED_ATTACHMENT_TYPES.join(",")} className="hidden" onChange={onFileSelected} data-testid="support-attachment-input" />
                <Button type="button" variant="outline" size="icon" onClick={pickFile} disabled={uploadingAttachment} data-testid="support-attach-button">
                  <Paperclip size={16} />
                </Button>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); }
                  }}
                  placeholder={composing ? "Type your message..." : "Type a message..."}
                  rows={2}
                  maxLength={4000}
                  className="resize-none"
                  data-testid="support-message-input"
                />
                <Button type="submit" disabled={sending || uploadingAttachment || (!body.trim() && !pendingAttachment)} data-testid="support-send-button">
                  <PaperPlaneTilt size={16} className="mr-2" /> Send
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
