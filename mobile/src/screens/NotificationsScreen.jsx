import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellSlash, FileText, Package, Users, Trash, X } from "@phosphor-icons/react";
import api from "../lib/api";
import { getPushSubscriptionState, isIosNotInstalled, subscribeToPush, unsubscribeFromPush } from "../lib/push";
import Brand from "../components/Brand";
import ThemeToggle from "../components/ThemeToggle";
import BackButton from "../components/BackButton";

const TYPE_ICON = {
  invoice_created: FileText,
  invoice_status: FileText,
  invoice_overdue: FileText,
  invoice_overdue_reminder: FileText,
  inventory_low: Package,
  inventory_sold: Package,
  payroll_run: Users,
  employee_added: Users,
  employee_removed: Users,
  team_joined: Users,
};

function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsScreen() {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [pushState, setPushState] = useState("checking");
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPushSubscriptionState()
      .then((state) => {
        if (!cancelled) setPushState(state);
      })
      .catch(() => {
        if (!cancelled) setPushState("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enablePush = async () => {
    setPushBusy(true);
    setError("");
    try {
      await subscribeToPush();
      setPushState("subscribed");
    } catch (err) {
      setError(err.message === "Permission not granted" ? "Notifications were blocked. You can allow them in your browser settings." : "Couldn't enable notifications.");
      setPushState(await getPushSubscriptionState());
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    setPushBusy(true);
    setError("");
    try {
      await unsubscribeFromPush();
      setPushState("unsubscribed");
    } catch {
      setError("Couldn't disable notifications.");
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    api
      .get("/notifications")
      .then(({ data }) => {
        if (cancelled) return;
        setItems(data.items);
        if (data.unread_count > 0) {
          api.post("/notifications/read-all").catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load notifications.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClick = (n) => {
    if (n.link) navigate(n.link);
  };

  const dismiss = async (id) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.delete(`/notifications/${id}`);
    } catch {
      setError("Couldn't dismiss that notification.");
    }
  };

  const clearAll = async () => {
    const prev = items;
    setItems([]);
    try {
      await api.delete("/notifications");
    } catch {
      setError("Couldn't clear notifications.");
      setItems(prev);
    }
  };

  return (
    <div className="screen screen-narrow">
      <div className="top-row">
        <div className="top-row-left">
          <BackButton to="/" />
          <Brand compact />
        </div>
        <div className="top-row-left">
          {items && items.length > 0 && (
            <button type="button" className="icon-btn" aria-label="Clear all notifications" title="Clear all" onClick={clearAll}>
              <Trash size={16} />
            </button>
          )}
          <ThemeToggle />
        </div>
      </div>
      <div className="eyebrow">Updates</div>
      <h2 className="heading">Notifications</h2>

      {pushState === "unsupported" && (
        <div className="banner banner-warning">
          {isIosNotInstalled()
            ? "To get push notifications on iPhone, add LedgerlyGo to your home screen first (Share → Add to Home Screen), then reopen it from there."
            : "Push notifications aren't supported in this browser."}
        </div>
      )}
      {pushState === "denied" && (
        <div className="banner banner-warning">Notifications are blocked for this app. Enable them in your browser/phone settings to turn them back on.</div>
      )}
      {pushState === "unsubscribed" && (
        <button type="button" className="btn-outline" style={{ marginBottom: "1rem" }} onClick={enablePush} disabled={pushBusy}>
          <Bell size={16} style={{ marginRight: "0.5rem", verticalAlign: "-3px" }} />
          {pushBusy ? "Enabling…" : "Enable push notifications"}
        </button>
      )}
      {pushState === "subscribed" && (
        <button type="button" className="btn-outline" style={{ marginBottom: "1rem" }} onClick={disablePush} disabled={pushBusy}>
          <BellSlash size={16} style={{ marginRight: "0.5rem", verticalAlign: "-3px" }} />
          {pushBusy ? "Disabling…" : "Disable push notifications"}
        </button>
      )}

      {error && <p className="error-text">{error}</p>}
      {items === null && !error && <p className="subtitle">Loading…</p>}
      {items && items.length === 0 && <p className="subtitle">You're all caught up.</p>}

      {items && items.length > 0 && (
        <div className="list">
          {items.map((n) => {
            const Icon = TYPE_ICON[n.type] || Bell;
            return (
              <div className="list-card" key={n.id}>
                <button type="button" className="list-info-btn" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }} onClick={() => handleClick(n)}>
                  <div className="notif-icon">
                    <Icon size={16} />
                  </div>
                  <div className="list-info">
                    <div className="list-title">{n.title}</div>
                    {n.message && <div className="list-meta">{n.message}</div>}
                    <div className="list-meta">{timeAgo(n.created_at)}</div>
                  </div>
                </button>
                {!n.read && <span className="unread-dot" />}
                <button type="button" className="icon-btn list-delete-btn" aria-label="Dismiss" onClick={() => dismiss(n.id)}>
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
