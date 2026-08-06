import { useNavigate } from "react-router-dom";
import { Bell, Gear, Receipt, Package, FileText, SignOut, CaretRight } from "@phosphor-icons/react";
import { clearToken, getUser } from "../lib/auth";
import { useUnreadCount } from "../lib/notifications";
import { unsubscribeFromPush } from "../lib/push";
import Brand from "../components/Brand";
import AppShell from "../components/AppShell";

const modules = [
  { to: "/receipts", label: "Receipts", subtitle: "Capture and review expenses", Icon: Receipt },
  { to: "/inventory", label: "Inventory", subtitle: "Track stock and low-stock alerts", Icon: Package },
  { to: "/invoices", label: "Invoices", subtitle: "Create invoices and update status", Icon: FileText },
];

export default function HomeScreen() {
  const navigate = useNavigate();
  const user = getUser();
  const unreadCount = useUnreadCount();

  const handleLogout = async () => {
    // Best-effort - the subscription record just goes stale (and gets
    // pruned on its next 404/410) if this fails for any reason.
    await unsubscribeFromPush().catch(() => {});
    clearToken();
    navigate("/login");
  };

  return (
    <AppShell>
      <div className="screen screen-narrow">
        <div className="top-row">
          <Brand />
          <div className="top-row-left">
            <button
              type="button"
              className="icon-btn"
              style={{ position: "relative" }}
              aria-label="Notifications"
              title="Notifications"
              onClick={() => navigate("/notifications")}
            >
              <Bell size={18} />
              {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={() => navigate("/settings")}>
              <Gear size={18} />
            </button>
          </div>
        </div>
        <div className="eyebrow">Welcome</div>
        <h2 className="heading">{user?.name || "Hi there"}</h2>
        <p className="subtitle">Signed in as {user?.email}</p>

        <div className="module-grid">
          {modules.map(({ to, label, subtitle, Icon }) => (
            <button key={to} type="button" className="module-card" onClick={() => navigate(to)}>
              <div className="module-card-icon">
                <Icon size={22} weight="duotone" />
              </div>
              <div className="module-card-info">
                <div className="list-title">{label}</div>
                <div className="list-meta">{subtitle}</div>
              </div>
              <CaretRight size={16} className="module-card-chevron" />
            </button>
          ))}
        </div>

        <button type="button" className="btn-outline" onClick={handleLogout} style={{ marginTop: "1.5rem" }}>
          <SignOut size={16} style={{ marginRight: "0.5rem" }} /> Log out
        </button>
      </div>
    </AppShell>
  );
}
