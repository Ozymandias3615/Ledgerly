import React, { useEffect, useRef, useState } from "react";
import api, { API } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatApiError } from "@/lib/utils_app";
import { Sparkle, PaperPlaneRight, Plus, Trash, ChatCircle } from "@phosphor-icons/react";
import { toast } from "sonner";

function renderMarkdown(md) {
  // super-light markdown for headings, bold, bullets
  if (!md) return null;
  const lines = md.split("\n");
  const out = [];
  let listBuf = [];
  const flushList = () => {
    if (listBuf.length) {
      out.push(<ul key={`ul-${out.length}`} className="list-disc pl-6 space-y-1 my-2">{listBuf.map((li, i) => <li key={i} dangerouslySetInnerHTML={{ __html: li }} />)}</ul>);
      listBuf = [];
    }
  };
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) { flushList(); out.push(<h4 key={idx} className="font-bold mt-3 text-slate-900" style={{ fontFamily: "Manrope, sans-serif" }}>{line.replace(/^###\s+/, "")}</h4>); }
    else if (/^##\s+/.test(line)) { flushList(); out.push(<h3 key={idx} className="font-bold mt-4 text-lg text-slate-900" style={{ fontFamily: "Manrope, sans-serif" }}>{line.replace(/^##\s+/, "")}</h3>); }
    else if (/^#\s+/.test(line)) { flushList(); out.push(<h2 key={idx} className="font-extrabold mt-4 text-xl text-slate-900" style={{ fontFamily: "Manrope, sans-serif" }}>{line.replace(/^#\s+/, "")}</h2>); }
    else if (/^\s*[-*]\s+/.test(line)) { listBuf.push(inline(line.replace(/^\s*[-*]\s+/, ""))); }
    else if (line.trim() === "") { flushList(); }
    else { flushList(); out.push(<p key={idx} className="text-slate-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: inline(line) }} />); }
  });
  flushList();
  return out;
}

const SUGGESTIONS = [
  "Give me an overview of my business financial health.",
  "Where am I spending the most, and what can I cut?",
  "How is my cash flow trending month over month?",
];

export default function InsightsPage() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadConversations = async () => {
    const { data } = await api.get("/insights/conversations");
    setConversations(data);
  };
  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const openConversation = async (id) => {
    const { data } = await api.get(`/insights/conversations/${id}`);
    setActiveId(id);
    setMessages(data.messages);
  };

  const newChat = () => {
    setActiveId(null);
    setMessages([]);
    setInput("");
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const requestDeleteConversation = (e, id) => {
    e.stopPropagation();
    setConfirmDeleteId(id);
  };

  const confirmDeleteConversation = async () => {
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    try {
      await api.delete(`/insights/conversations/${id}`);
      if (id === activeId) newChat();
      loadConversations();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: message }]);
    setSending(true);

    let assistantAdded = false;
    const appendChunk = (chunk) => {
      setMessages((m) => {
        const next = [...m];
        if (!assistantAdded) {
          next.push({ role: "assistant", content: chunk });
          assistantAdded = true;
        } else {
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + chunk };
        }
        return next;
      });
    };
    const showError = (msg) => {
      toast.error(msg);
      setMessages((m) => {
        const next = [...m];
        if (assistantAdded) next[next.length - 1] = { ...next[next.length - 1], content: `> ${msg}` };
        else next.push({ role: "assistant", content: `> ${msg}` });
        return next;
      });
    };

    try {
      const res = await fetch(`${API}/insights/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, conversation_id: activeId }),
      });

      if (!res.ok) {
        let detail = `Request failed (${res.status})`;
        try {
          const data = await res.json();
          if (typeof data.detail === "string") detail = data.detail;
        } catch {
          // non-JSON error body; keep the generic message
        }
        showError(detail);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamDone = false;
      while (!streamDone) {
        const { value, done } = await reader.read();
        streamDone = done;
        if (value) buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!frame.startsWith("data: ")) continue;
          const evt = JSON.parse(frame.slice(6));
          if (evt.type === "meta") setActiveId(evt.conversation_id);
          else if (evt.type === "chunk") appendChunk(evt.text);
          else if (evt.type === "error") showError(evt.message);
          else if (evt.type === "done") loadConversations();
        }
      }
    } catch (err) {
      showError(err?.message || "Something went wrong.");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="h-full flex" data-testid="insights-page">
      {/* Conversations sidebar */}
      <aside className="w-64 shrink-0 border-r border-slate-200 flex flex-col bg-slate-50/50">
        <div className="p-4 shrink-0">
          <Button onClick={newChat} className="w-full bg-slate-900 hover:bg-slate-800" data-testid="new-chat-button">
            <Plus size={16} className="mr-2" /> New chat
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4 space-y-0.5">
          {conversations.length === 0 ? (
            <div className="text-xs text-slate-400 text-center px-4 py-6">No conversations yet</div>
          ) : conversations.map((c) => (
            <button
              key={c.conversation_id}
              onClick={() => openConversation(c.conversation_id)}
              className={`group w-full flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors ${
                c.conversation_id === activeId ? "bg-slate-200/70 text-slate-900" : "text-slate-600 hover:bg-slate-100"
              }`}
              data-testid={`conversation-${c.conversation_id}`}
            >
              <ChatCircle size={14} className="shrink-0 text-slate-400" />
              <span className="flex-1 truncate">{c.title}</span>
              <span
                role="button"
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-red-600 transition-opacity"
                onClick={(e) => requestDeleteConversation(e, c.conversation_id)}
                title="Delete"
              >
                <Trash size={13} />
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 px-8 pt-6 pb-4 border-b border-slate-100">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Powered by Groq</div>
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ fontFamily: "Manrope, sans-serif" }}>AI Financial Insights</h1>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
          {messages.length === 0 ? (
            <div className="h-full grid place-items-center">
              <div className="text-center max-w-md">
                <div className="h-12 w-12 rounded-full bg-slate-900 grid place-items-center mx-auto mb-4">
                  <Sparkle size={22} weight="fill" className="text-white" />
                </div>
                <div className="font-bold text-lg mb-1" style={{ fontFamily: "Manrope, sans-serif" }}>Ask about your books</div>
                <div className="text-sm text-slate-500 mb-6">Get expert analysis grounded in your live business data.</div>
                <div className="space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="w-full text-left text-sm border border-slate-200 rounded-md px-3 py-2 text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-5">
              {messages.map((m, i) => {
                const isStreaming = sending && i === messages.length - 1 && m.role === "assistant";
                return m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="bg-slate-900 text-white rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%] text-sm whitespace-pre-wrap">{m.content}</div>
                  </div>
                ) : (
                  <div key={i} className="flex gap-3">
                    <div className="h-7 w-7 rounded-full bg-slate-900 grid place-items-center shrink-0 mt-0.5">
                      <Sparkle size={13} weight="fill" className={`text-white ${isStreaming ? "animate-pulse" : ""}`} />
                    </div>
                    <div className="min-w-0 flex-1 text-sm space-y-1" data-testid="insight-output">
                      {renderMarkdown(m.content)}
                      {isStreaming && <span className="inline-block w-1.5 h-4 bg-slate-400 align-text-bottom animate-pulse" />}
                    </div>
                  </div>
                );
              })}
              {sending && messages[messages.length - 1]?.role !== "assistant" && (
                <div className="flex gap-3">
                  <div className="h-7 w-7 rounded-full bg-slate-900 grid place-items-center shrink-0">
                    <Sparkle size={13} weight="fill" className="text-white animate-pulse" />
                  </div>
                  <div className="text-sm text-slate-400 pt-1">Analyzing your books...</div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 px-8 py-4">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <Textarea
              rows={1}
              placeholder="Ask about your finances..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              className="resize-none min-h-[44px] max-h-40"
              data-testid="insight-question-input"
            />
            <Button
              onClick={() => send()}
              disabled={sending || !input.trim()}
              className="bg-slate-900 hover:bg-slate-800 h-11 w-11 p-0 shrink-0"
              data-testid="generate-insight-button"
              title="Send"
            >
              <PaperPlaneRight size={17} weight="fill" />
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
        title="Delete this conversation?"
        description="This can't be undone. The conversation and all its messages will be permanently removed."
        onConfirm={confirmDeleteConversation}
      />
    </div>
  );
}
