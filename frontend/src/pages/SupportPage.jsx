import React, { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatApiError } from "@/lib/utils_app";
import { PaperPlaneTilt } from "@phosphor-icons/react";
import { toast } from "sonner";

function timeLabel(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function SupportPage() {
  const { user, refresh } = useAuth();
  const [messages, setMessages] = useState(null);
  const [thread, setThread] = useState(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const bottomRef = useRef(null);

  const load = () => {
    setLoadError("");
    api.get("/support/messages").then(({ data }) => {
      setThread(data.thread);
      setMessages(data.messages);
      // Clears the unread badge in the sidebar - the GET above already
      // marked unread_by_user false server-side, this just syncs the
      // locally-cached user object to match.
      if (user?.support_unread) refresh();
    }).catch((err) => setLoadError(formatApiError(err) || "Failed to load messages"));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      const { data } = await api.post("/support/messages", { body: text });
      setMessages((prev) => [...(prev || []), data]);
      setBody("");
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-8 h-full flex flex-col" data-testid="support-page">
      <div className="mb-6 shrink-0">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Support</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Contact us</h1>
        <div className="text-sm text-slate-500 mt-1">
          {thread?.status === "resolved"
            ? "This conversation was marked resolved - send a new message any time to reopen it."
            : "Send us a message and we'll reply here."}
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-slate-200 flex flex-col overflow-hidden bg-white">
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
          {loadError ? (
            <div className="text-sm text-red-600">{loadError}</div>
          ) : !messages ? (
            <div className="text-sm text-slate-500">Loading...</div>
          ) : messages.length === 0 ? (
            <div className="text-sm text-slate-500 text-center mt-8">
              No messages yet - say hello below and we'll get back to you.
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.message_id} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[70%] rounded-lg px-4 py-2 ${m.sender === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"}`}>
                  <div className="text-xs opacity-70 mb-1">{m.sender === "user" ? "You" : m.sender_name} · {timeLabel(m.created_at)}</div>
                  <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={send} className="shrink-0 border-t border-slate-200 p-4 flex gap-2 items-end">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); }
            }}
            placeholder="Type a message..."
            rows={2}
            maxLength={4000}
            className="resize-none"
            data-testid="support-message-input"
          />
          <Button type="submit" disabled={sending || !body.trim()} data-testid="support-send-button">
            <PaperPlaneTilt size={16} className="mr-2" /> Send
          </Button>
        </form>
      </div>
    </div>
  );
}
