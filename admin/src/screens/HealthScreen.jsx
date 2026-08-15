import { useEffect, useState } from "react";
import { ArrowSquareOut, CheckCircle, WarningCircle, XCircle } from "@phosphor-icons/react";
import api from "../lib/api";

function formatRelative(iso) {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const levelColor = {
  fatal: "--destructive",
  error: "--destructive",
  warning: "--amber",
  info: "--primary",
};

function SentryIssues() {
  const [issues, setIssues] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/admin/sentry/issues")
      .then(({ data }) => setIssues(data))
      .catch((err) => setError(err.response?.data?.detail || "Failed to load Sentry issues"));
  }, []);

  return (
    <div className="card card-pad">
      <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>Recent errors (backend, unresolved, last 14 days)</div>
      {error ? (
        <p className="muted">{error}</p>
      ) : !issues ? (
        <p className="muted">Loading...</p>
      ) : issues.length === 0 ? (
        <p className="muted">No unresolved errors. Clean slate.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {issues.map((issue) => (
            <a
              key={issue.id}
              href={issue.permalink}
              target="_blank"
              rel="noreferrer"
              style={{ display: "block", textDecoration: "none", color: "inherit", borderBottom: "1px solid hsl(var(--border))", paddingBottom: "0.6rem" }}
            >
              <div className="row-between">
                <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600, fontSize: "0.875rem" }}>
                  <WarningCircle size={14} style={{ color: `hsl(var(${levelColor[issue.level] || "--muted-foreground"}))` }} />
                  {issue.title}
                  <ArrowSquareOut size={12} className="muted" />
                </span>
                <span className="muted" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>{issue.count}× · {formatRelative(issue.last_seen)}</span>
              </div>
              {issue.culprit && <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.15rem" }}>{issue.culprit}</div>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="card card-pad">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function ConfigRow({ label, ok }) {
  return (
    <div className="config-row">
      <span>{label}</span>
      {ok ? (
        <span className="ok-yes"><CheckCircle size={16} weight="fill" /> Configured</span>
      ) : (
        <span className="ok-no"><XCircle size={16} weight="fill" /> Missing</span>
      )}
    </div>
  );
}

export default function HealthScreen() {
  const [health, setHealth] = useState(null);
  const [debugStatus, setDebugStatus] = useState("");

  useEffect(() => {
    api.get("/admin/health").then(({ data }) => setHealth(data));
  }, []);

  const sendTestError = () => {
    setDebugStatus("Sending...");
    api.get("/admin/sentry-debug")
      .then(() => setDebugStatus("Unexpected: no error was raised."))
      .catch((err) => {
        setDebugStatus(
          err.response?.status === 500
            ? "Sent — should show up in Sentry within a minute."
            : err.response?.data?.detail || "Failed to reach the debug endpoint."
        );
      });
  };

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Internal</div>
        <h1 className="page-title">System health</h1>
        <p className="page-subtitle">A glance at things that break silently</p>
      </div>

      {!health ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
          <div className="stat-grid" style={{ marginBottom: "1.5rem" }}>
            <StatCard label="Total users" value={health.total_users} />
            <StatCard label="Total businesses" value={health.total_businesses} />
            <StatCard label="Active sessions" value={health.active_sessions} hint={`${health.total_sessions} total`} />
            <StatCard label="Push subscriptions" value={health.push_subscriptions} hint={`${health.push_subscribed_users} user(s)`} />
          </div>

          <div className="card card-pad" style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>Shared Groq AI quota (today)</div>
            <div className="stat-value">{health.ai_shared_usage_today} calls</div>
            <div className="stat-hint">{health.ai_shared_daily_limit}/day cap, per business</div>
            {health.businesses_at_ai_cap_today.length > 0 && (
              <p className="warn-text">
                At today's cap: {health.businesses_at_ai_cap_today.join(", ")} — reset from the Businesses tab if needed.
              </p>
            )}
          </div>

          <div className="card card-pad" style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>Integrations</div>
            <ConfigRow label="Sentry error monitoring" ok={health.sentry_configured} />
            <ConfigRow label="Sentry API (error feed below)" ok={health.sentry_api_configured} />
            <ConfigRow label="Shared Groq AI key" ok={health.groq_shared_key_configured} />
            <ConfigRow label="Web Push (VAPID keys)" ok={health.vapid_configured} />
            {health.sentry_configured && (
              <div className="row-between" style={{ marginTop: "0.75rem" }}>
                <button type="button" className="btn btn-outline" onClick={sendTestError}>
                  Send test error
                </button>
                {debugStatus && <span className="muted" style={{ fontSize: "0.8rem" }}>{debugStatus}</span>}
              </div>
            )}
          </div>

          {health.sentry_api_configured && <SentryIssues />}
        </>
      )}
    </div>
  );
}
