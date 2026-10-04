import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatApiError } from "@/lib/utils_app";
import { ArrowDown, PaperPlaneTilt, Plus, Paperclip, File as FileIcon, X } from "@phosphor-icons/react";
import { toast } from "sonner";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = [
  "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf",
  "video/mp4", "video/webm", "video/quicktime",
];

// Same live-chat timings as admin/src/screens/SupportScreen.jsx - the
// server shows "typing" for 6s after a ping.
const MESSAGE_POLL_MS = 3000;
const TYPING_PING_MS = 2500;
const NEAR_BOTTOM_PX = 80;

function TypingBubble() {
  return (
    <div className="flex justify-start" aria-live="polite" data-testid="support-admin-typing">
      <div className="rounded-lg px-4 py-3 bg-slate-100 text-slate-500 flex items-center gap-1" aria-label="Ledgerly Support is typing" title="Ledgerly Support is typing">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="h-1.5 w-1.5 rounded-full bg-current animate-bounce motion-reduce:animate-none" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </div>
    </div>
  );
}

function timeLabel(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function Attachment({ message, onPreview }) {
  if (!message.attachment_data) return null;
  const src = `data:${message.attachment_content_type};base64,${message.attachment_data}`;
  const isImage = message.attachment_content_type?.startsWith("image/");
  const isVideo = message.attachment_content_type?.startsWith("video/");
  return (
    <div className={message.body ? "mt-2" : ""}>
      {isImage ? (
        <button type="button" onClick={() => onPreview({ src, type: "image", filename: message.attachment_filename })} className="block p-0 border-0 bg-transparent cursor-zoom-in">
          <img src={src} alt={message.attachment_filename} className="max-w-full max-h-48 rounded-md border border-slate-200" />
        </button>
      ) : isVideo ? (
        <button type="button" onClick={() => onPreview({ src, type: "video", filename: message.attachment_filename })} className="block p-0 border-0 bg-transparent cursor-zoom-in">
          <video src={src} className="max-w-full max-h-48 rounded-md border border-slate-200" muted />
        </button>
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

function PreviewLightbox({ preview, onClose }) {
  if (!preview) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
      onClick={onClose}
      data-testid="support-attachment-lightbox"
    >
      <button type="button" onClick={onClose} className="absolute top-4 right-4 text-white/80 hover:text-white">
        <X size={28} />
      </button>
      {preview.type === "image" ? (
        <img src={preview.src} alt={preview.filename} className="max-w-full max-h-full rounded-md" onClick={(e) => e.stopPropagation()} />
      ) : (
        <video src={preview.src} className="max-w-full max-h-full rounded-md" controls autoPlay onClick={(e) => e.stopPropagation()} />
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
  const [preview, setPreview] = useState(null);
  const [hasUnseenBelow, setHasUnseenBelow] = useState(false);
  const listRef = useRef(null);
  const nearBottomRef = useRef(true);
  const scrollIntentRef = useRef(null); // "jump" | "own" | "follow" | "follow-if-near"
  const selectedIdRef = useRef(null);
  const lastTypingPingRef = useRef(0);
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

  // Poll the open conversation for Support's replies, typing state and
  // status changes (e.g. resolved), asking only for newer messages.
  const lastCreatedAt = detail?.messages?.length ? detail.messages[detail.messages.length - 1].created_at : null;
  useEffect(() => {
    if (!selectedId || selectedId === "new" || !detail) return undefined;
    const threadId = selectedId;
    const id = setInterval(() => {
      if (document.hidden) return;
      api.get(`/support/threads/${threadId}/messages`, { params: lastCreatedAt ? { after: lastCreatedAt } : {} })
        .then(({ data }) => {
          if (selectedIdRef.current !== threadId) return;
          setDetail((prev) => {
            if (!prev) return prev;
            const known = new Set(prev.messages.map((m) => m.message_id));
            const fresh = data.messages.filter((m) => !known.has(m.message_id));
            if (fresh.length) scrollIntentRef.current = "follow";
            else if (data.thread.admin_typing !== prev.thread.admin_typing) scrollIntentRef.current = "follow-if-near";
            return { thread: { ...prev.thread, ...data.thread }, messages: fresh.length ? [...prev.messages, ...fresh] : prev.messages };
          });
        })
        .catch(() => {});
    }, MESSAGE_POLL_MS);
    return () => clearInterval(id);
  }, [selectedId, !!detail, lastCreatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening a thread or sending jumps to the bottom; new replies only follow
  // along if you haven't scrolled up to read earlier messages.
  useLayoutEffect(() => {
    const el = listRef.current;
    const intent = scrollIntentRef.current;
    scrollIntentRef.current = null;
    if (!el || !intent) return;
    if (intent === "jump" || intent === "own") {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
      setHasUnseenBelow(false);
    } else if (nearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else if (intent === "follow") {
      setHasUnseenBelow(true);
    }
  }, [detail]);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottomRef.current) setHasUnseenBelow(false);
  };

  const scrollToBottom = () => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    setHasUnseenBelow(false);
  };

  const onBodyChange = (e) => {
    setBody(e.target.value);
    const now = Date.now();
    if (e.target.value.trim() && selectedId && selectedId !== "new" && now - lastTypingPingRef.current > TYPING_PING_MS) {
      lastTypingPingRef.current = now;
      api.post(`/support/threads/${selectedId}/typing`).catch(() => {});
    }
  };

  const openThread = (threadId) => {
    setSelectedId(threadId);
    selectedIdRef.current = threadId;
    setDetail(null);
    setDetailError("");
    setHasUnseenBelow(false);
    api.get(`/support/threads/${threadId}/messages`)
      .then(({ data }) => {
        if (selectedIdRef.current !== threadId) return;
        scrollIntentRef.current = "jump";
        setDetail(data);
        setThreads((prev) => prev && prev.map((t) => (t.thread_id === threadId ? { ...t, unread_by_user: false } : t)));
        if (user?.support_unread) refresh();
      })
      .catch((err) => setDetailError(formatApiError(err) || "Failed to load conversation"));
  };

  const startNew = () => {
    setSelectedId("new");
    selectedIdRef.current = "new";
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
      toast.error("Attachments must be a PNG, JPEG, WEBP, GIF, PDF, MP4, WEBM, or MOV file");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error("Attachment must be smaller than 10MB");
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
        scrollIntentRef.current = "own";
        setSelectedId(data.thread.thread_id);
        selectedIdRef.current = data.thread.thread_id;
        setDetail(data);
        setThreads((prev) => [data.thread, ...(prev || [])]);
      } else {
        const { data } = await api.post(`/support/threads/${selectedId}/messages`, payload);
        scrollIntentRef.current = "own";
        lastTypingPingRef.current = 0;
        setDetail((prev) => (prev.messages.some((m) => m.message_id === data.message_id) ? prev : { ...prev, messages: [...prev.messages, data] }));
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

        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 relative flex flex-col">
          <div ref={listRef} onScroll={onListScroll} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4" data-testid="support-message-list">
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
                    <Attachment message={m} onPreview={setPreview} />
                  </div>
                </div>
              ))
            )}
            {!composing && detail?.thread?.admin_typing && detail.thread.status !== "resolved" && <TypingBubble />}
          </div>
          {hasUnseenBelow && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900 text-white text-xs px-3 py-1.5 shadow-md flex items-center gap-1"
              data-testid="support-new-messages-button"
            >
              <ArrowDown size={12} /> New messages
            </button>
          )}
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
              <div className="flex gap-2 items-center">
                <input ref={fileInputRef} type="file" accept={ALLOWED_ATTACHMENT_TYPES.join(",")} className="hidden" onChange={onFileSelected} data-testid="support-attachment-input" />
                <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={pickFile} disabled={uploadingAttachment} data-testid="support-attach-button">
                  <Paperclip size={16} />
                </Button>
                <Textarea
                  value={body}
                  onChange={onBodyChange}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); }
                  }}
                  placeholder={composing ? "Type your message..." : "Type a message..."}
                  rows={1}
                  maxLength={4000}
                  className="h-9 min-h-9 resize-none py-2"
                  data-testid="support-message-input"
                />
                <Button type="submit" className="h-9 shrink-0" disabled={sending || uploadingAttachment || (!body.trim() && !pendingAttachment)} data-testid="support-send-button">
                  <PaperPlaneTilt size={16} className="mr-2" /> Send
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
      <PreviewLightbox preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
