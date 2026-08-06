import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Gear, Receipt, Package, FileText, SignOut, CaretRight, X } from "@phosphor-icons/react";
import api from "../lib/api";
import { clearToken, getUser, updateStoredUser } from "../lib/auth";
import { fmtAmount, isLowStock } from "../lib/format";
import { useUnreadCount } from "../lib/notifications";
import { unsubscribeFromPush } from "../lib/push";
import Brand from "../components/Brand";
import AppShell from "../components/AppShell";

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonthLabel() {
  return new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const modules = [
  { to: "/receipts", label: "Receipts", subtitle: "Capture and review expenses", Icon: Receipt },
  { to: "/inventory", label: "Inventory", subtitle: "Track stock and low-stock alerts", Icon: Package },
  { to: "/invoices", label: "Invoices", subtitle: "Create invoices and update status", Icon: FileText },
];

export default function HomeScreen() {
  const navigate = useNavigate();
  const user = getUser();
  const unreadCount = useUnreadCount();
  const [summary, setSummary] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  // Business currency can change after login (e.g. desktop Settings > Business),
  // but the cached user in localStorage doesn't - re-fetch it here rather than
  // trusting `user.currency`, which is what left this figure showing the old
  // symbol after a currency relabel while every record-backed screen (which
  // reads currency off each transaction/invoice) updated immediately.
  const [currency, setCurrency] = useState(user?.currency);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get("/reports/dashboard"), api.get("/invoices"), api.get("/inventory"), api.get("/auth/me")])
      .then(([dashboard, invoices, inventory, me]) => {
        if (cancelled) return;
        const month = dashboard.data.monthly.find((m) => m.month === currentMonthKey());
        setSummary({
          income: month?.income ?? 0,
          expense: month?.expense ?? 0,
          net: month?.net ?? 0,
          overdueCount: invoices.data.filter((i) => i.status === "overdue").length,
          lowStockCount: inventory.data.filter(isLowStock).length,
        });
        if (me.data.currency) {
          setCurrency(me.data.currency);
          updateStoredUser({ currency: me.data.currency });
        }
      })
      // Silent failure - the summary is a nice-to-have glance, not worth an
      // error banner on the screen every screen re-enters through.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

        {summary ? (
          <div className="stat-grid">
            <button type="button" className="stat-tile" onClick={() => setShowBreakdown(true)}>
              {/* Sign is dropped here - the red/green color already says profit vs.
                  loss, and the breakdown modal has the exact signed figures. */}
              <div className={`stat-value ${summary.net < 0 ? "stat-negative" : "stat-positive"}`}>{fmtAmount(Math.abs(summary.net), currency)}</div>
              <div className="stat-label">This month</div>
            </button>
            <button type="button" className="stat-tile" onClick={() => navigate("/invoices")}>
              <div className={`stat-value${summary.overdueCount > 0 ? " stat-negative" : ""}`}>{summary.overdueCount}</div>
              <div className="stat-label">Overdue</div>
            </button>
            <button type="button" className="stat-tile" onClick={() => navigate("/inventory")}>
              <div className={`stat-value${summary.lowStockCount > 0 ? " stat-warning" : ""}`}>{summary.lowStockCount}</div>
              <div className="stat-label">Low stock</div>
            </button>
          </div>
        ) : (
          // Reserves the same grid space immediately instead of the tiles
          // popping in once the 3 parallel requests resolve, which read as a
          // layout jump ("spawns in a few seconds after everything else").
          <div className="stat-grid" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="stat-tile">
                <div className="skeleton-bar skeleton-bar-value" />
                <div className="skeleton-bar skeleton-bar-label" />
              </div>
            ))}
          </div>
        )}

        {showBreakdown && summary && (
          <div className="modal-overlay" onClick={() => setShowBreakdown(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <div className="list-title">This month</div>
                  <div className="list-meta">{currentMonthLabel()}</div>
                </div>
                <button type="button" className="icon-btn" aria-label="Close" onClick={() => setShowBreakdown(false)}>
                  <X size={16} />
                </button>
              </div>
              <div className="totals-box">
                <div className="totals-row">
                  <span>Income</span>
                  <span>{fmtAmount(summary.income, currency)}</span>
                </div>
                <div className="totals-row">
                  <span>Expenses</span>
                  <span>{fmtAmount(summary.expense, currency)}</span>
                </div>
                <div className="totals-row-bold">
                  <span>Net</span>
                  <span>{fmtAmount(summary.net, currency)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

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
