import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChatCircle, Plus } from "@phosphor-icons/react";
import api from "../lib/api";
import Brand from "../components/Brand";
import BackButton from "../components/BackButton";
import { supportTimeLabel } from "../lib/support";

// Same /support/* endpoints as desktop SupportPage.jsx and Pulse - support
// conversations belong to the account, not the Personal/Business context.
export default function SupportScreen() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get("/support/threads")
      .then(({ data }) => {
        if (!cancelled) setThreads(data);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your conversations.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="screen screen-narrow">
      <div className="top-row">
        <div className="top-row-left">
          <BackButton to="/" />
          <Brand compact />
        </div>
        <button type="button" className="icon-btn" aria-label="New conversation" title="New conversation" onClick={() => navigate("/support/new")}>
          <Plus size={16} />
        </button>
      </div>
      <div className="eyebrow">Support</div>
      <h2 className="heading">Contact us</h2>
      <p className="subtitle">Start a new conversation, or continue an existing one. We'll reply here.</p>

      {error && <p className="error-text">{error}</p>}
      {threads === null && !error && (
        <p className="subtitle thinking">
          <span className="thinking-dots"><span /><span /><span /></span>
          Loading
        </p>
      )}

      {threads && threads.length === 0 && (
        <div className="card" style={{ textAlign: "center" }}>
          <ChatCircle size={28} style={{ opacity: 0.6 }} />
          <p className="subtitle" style={{ margin: "0.5rem 0 1rem" }}>No conversations yet.</p>
          <button type="button" className="btn-primary" onClick={() => navigate("/support/new")}>
            Start a conversation
          </button>
        </div>
      )}

      {threads && threads.length > 0 && (
        <>
          <div className="list">
            {threads.map((t) => (
              <button type="button" className="list-card" key={t.thread_id} onClick={() => navigate(`/support/${t.thread_id}`)} style={{ textAlign: "left" }}>
                <div className="list-info" style={{ minWidth: 0 }}>
                  <div className="list-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject || "Conversation"}</div>
                  <div className="list-meta">
                    <span className={`support-status support-status-${t.status}`}>{t.status}</span> · {supportTimeLabel(t.updated_at)}
                  </div>
                </div>
                {t.unread_by_user && <span className="support-unread-dot" aria-label="New reply" />}
              </button>
            ))}
          </div>
          <button type="button" className="btn-outline" style={{ marginTop: "1rem" }} onClick={() => navigate("/support/new")}>
            New conversation
          </button>
        </>
      )}
    </div>
  );
}
