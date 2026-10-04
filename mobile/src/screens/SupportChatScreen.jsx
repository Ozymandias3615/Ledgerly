import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDown, File as FileIcon, PaperPlaneTilt, Paperclip, X } from "@phosphor-icons/react";
import api from "../lib/api";
import BackButton from "../components/BackButton";
import {
  ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MESSAGE_POLL_MS, NEAR_BOTTOM_PX, TYPING_PING_MS, supportTimeLabel,
} from "../lib/support";

function Attachment({ message, onPreview }) {
  if (!message.attachment_data) return null;
  const src = `data:${message.attachment_content_type};base64,${message.attachment_data}`;
  const type = message.attachment_content_type || "";
  if (type.startsWith("image/") || type.startsWith("video/")) {
    const kind = type.startsWith("image/") ? "image" : "video";
    return (
      <button type="button" className="chat-media-btn" onClick={() => onPreview({ src, kind, filename: message.attachment_filename })}>
        {kind === "image" ? <img src={src} alt={message.attachment_filename} /> : <video src={src} muted playsInline />}
      </button>
    );
  }
  return (
    <a className="chat-file" href={src} download={message.attachment_filename}>
      <FileIcon size={16} />
      <span>{message.attachment_filename}</span>
    </a>
  );
}

// One chat screen for both an existing conversation (/support/:id) and a
// brand-new one (/support/new - the thread only exists once the first
// message is sent).
export default function SupportChatScreen() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = id === "new";

  const [detail, setDetail] = useState(isNew ? { thread: null, messages: [] } : null);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [hasUnseenBelow, setHasUnseenBelow] = useState(false);
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  const nearBottomRef = useRef(true);
  const scrollIntentRef = useRef(null); // "jump" | "own" | "follow" | "follow-if-near"
  const lastTypingPingRef = useRef(0);

  // The route can change under this same mounted screen (a resolved thread's
  // "New conversation", or /support/new becoming the real thread id after
  // the first send), so reset or load whenever the id changes.
  const justCreatedIdRef = useRef(null);
  useEffect(() => {
    setError("");
    setHasUnseenBelow(false);
    if (isNew) {
      setDetail({ thread: null, messages: [] });
      setBody("");
      setPendingAttachment(null);
      return undefined;
    }
    // Already have it - this is the new thread we just created and sent into.
    if (id === justCreatedIdRef.current) return undefined;
    let cancelled = false;
    setDetail(null);
    api
      .get(`/support/threads/${id}/messages`)
      .then(({ data }) => {
        if (cancelled) return;
        scrollIntentRef.current = "jump";
        setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.detail || "Couldn't load this conversation.");
      });
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  // Poll for Support's replies, typing state and status changes, asking only
  // for messages newer than the last one we have.
  const lastCreatedAt = detail?.messages?.length ? detail.messages[detail.messages.length - 1].created_at : null;
  const threadId = detail?.thread?.thread_id;
  useEffect(() => {
    if (!threadId) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      api
        .get(`/support/threads/${threadId}/messages`, { params: lastCreatedAt ? { after: lastCreatedAt } : {} })
        .then(({ data }) => {
          setDetail((prev) => {
            if (!prev?.thread || prev.thread.thread_id !== threadId) return prev;
            const known = new Set(prev.messages.map((m) => m.message_id));
            const fresh = data.messages.filter((m) => !known.has(m.message_id));
            if (fresh.length) scrollIntentRef.current = "follow";
            else if (data.thread.admin_typing !== prev.thread.admin_typing) scrollIntentRef.current = "follow-if-near";
            return { thread: { ...prev.thread, ...data.thread }, messages: fresh.length ? [...prev.messages, ...fresh] : prev.messages };
          });
        })
        .catch(() => {});
    }, MESSAGE_POLL_MS);
    return () => clearInterval(timer);
  }, [threadId, lastCreatedAt]);

  // Opening or sending jumps to the bottom; new replies only follow along if
  // you haven't scrolled up to read earlier messages.
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
    if (e.target.value.trim() && threadId && now - lastTypingPingRef.current > TYPING_PING_MS) {
      lastTypingPingRef.current = now;
      api.post(`/support/threads/${threadId}/typing`).catch(() => {});
    }
  };

  const onFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
      setError("Attachments must be a PNG, JPEG, WEBP, GIF, PDF, MP4, WEBM, or MOV file.");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError("Attachment must be smaller than 10MB.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post("/support/attachments", formData);
      setPendingAttachment(data);
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't upload that file.");
    } finally {
      setUploading(false);
    }
  };

  const send = async (e) => {
    e?.preventDefault();
    const text = body.trim();
    if ((!text && !pendingAttachment) || sending) return;
    setSending(true);
    setError("");
    try {
      const payload = { body: text, ...(pendingAttachment || {}) };
      scrollIntentRef.current = "own";
      if (!threadId) {
        const { data } = await api.post("/support/threads", payload);
        justCreatedIdRef.current = data.thread.thread_id;
        setDetail(data);
        // Swap the URL to the real thread so Back/refresh land on it.
        navigate(`/support/${data.thread.thread_id}`, { replace: true });
      } else {
        const { data } = await api.post(`/support/threads/${threadId}/messages`, payload);
        lastTypingPingRef.current = 0;
        setDetail((prev) => (prev.messages.some((m) => m.message_id === data.message_id) ? prev : { ...prev, messages: [...prev.messages, data] }));
      }
      setBody("");
      setPendingAttachment(null);
    } catch (err) {
      scrollIntentRef.current = null;
      setError(err.response?.data?.detail || "Couldn't send your message.");
    } finally {
      setSending(false);
    }
  };

  const thread = detail?.thread;
  const resolved = thread?.status === "resolved";
  const canSend = (body.trim() || pendingAttachment) && !sending && !uploading;

  return (
    <div className="chat-screen">
      <div className="chat-header">
        <BackButton to="/support" />
        <div style={{ minWidth: 0 }}>
          <div className="list-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isNew && !thread ? "New conversation" : thread?.subject || "Ledgerly Support"}
          </div>
          <div className="list-meta">{thread ? (resolved ? "Resolved" : "Ledgerly Support") : "We usually reply within a day"}</div>
        </div>
      </div>

      <div className="chat-body">
        <div ref={listRef} onScroll={onListScroll} className="chat-messages">
          {!detail && !error && (
            <p className="subtitle thinking">
              <span className="thinking-dots"><span /><span /><span /></span>
              Loading
            </p>
          )}
          {detail && detail.messages.length === 0 && (
            <p className="subtitle" style={{ textAlign: "center", marginTop: "2rem" }}>Say hello below to start a new conversation.</p>
          )}
          {detail?.messages.map((m) => (
            <div key={m.message_id} className={`chat-row ${m.sender === "user" ? "chat-row-mine" : ""}`}>
              <div className={`chat-bubble ${m.sender === "user" ? "chat-bubble-mine" : ""}`}>
                <div className="chat-meta">{m.sender === "user" ? "You" : m.sender_name} · {supportTimeLabel(m.created_at)}</div>
                {m.body && <div className="chat-text">{m.body}</div>}
                <Attachment message={m} onPreview={setPreview} />
              </div>
            </div>
          ))}
          {thread?.admin_typing && !resolved && (
            <div className="chat-row" aria-live="polite">
              <div className="chat-bubble" aria-label="Ledgerly Support is typing" title="Ledgerly Support is typing">
                <span className="thinking-dots"><span /><span /><span /></span>
              </div>
            </div>
          )}
        </div>
        {hasUnseenBelow && (
          <button type="button" className="chat-new-pill" onClick={scrollToBottom}>
            <ArrowDown size={12} /> New messages
          </button>
        )}
      </div>

      {error && <p className="error-text" style={{ padding: "0 1rem" }}>{error}</p>}

      {resolved ? (
        <div className="chat-composer chat-resolved">
          <span className="list-meta">This conversation was resolved.</span>
          <button type="button" className="btn-outline" onClick={() => navigate("/support/new")}>New conversation</button>
        </div>
      ) : (
        <form className="chat-composer" onSubmit={send}>
          {pendingAttachment && (
            <div className="chat-pending">
              <FileIcon size={14} />
              <span>{pendingAttachment.attachment_filename}</span>
              <button type="button" aria-label="Remove attachment" onClick={() => setPendingAttachment(null)}>
                <X size={14} />
              </button>
            </div>
          )}
          <div className="chat-input-row">
            <input ref={fileInputRef} type="file" accept={ALLOWED_ATTACHMENT_TYPES.join(",")} style={{ display: "none" }} onChange={onFileSelected} />
            <button type="button" className="icon-btn" aria-label="Attach a file" disabled={uploading || !detail} onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={18} />
            </button>
            <textarea
              value={body}
              onChange={onBodyChange}
              placeholder="Type a message..."
              rows={1}
              maxLength={4000}
              disabled={!detail}
            />
            <button type="submit" className="icon-btn chat-send" aria-label="Send" disabled={!canSend}>
              <PaperPlaneTilt size={18} weight="fill" />
            </button>
          </div>
        </form>
      )}

      {preview && (
        <div className="chat-lightbox" onClick={() => setPreview(null)}>
          <button type="button" className="chat-lightbox-close" aria-label="Close" onClick={() => setPreview(null)}>
            <X size={26} />
          </button>
          {preview.kind === "image" ? (
            <img src={preview.src} alt={preview.filename} onClick={(e) => e.stopPropagation()} />
          ) : (
            <video src={preview.src} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      )}
    </div>
  );
}
