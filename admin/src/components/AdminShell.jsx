import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { ArrowsClockwise, Key, SignOut } from "@phosphor-icons/react";
import { clearToken, getUser } from "../lib/auth";
import api from "../lib/api";
import Toaster from "./Toaster";
import SetPasswordModal from "./SetPasswordModal";

const tabs = [
  { to: "/users", label: "Users" },
  { to: "/businesses", label: "Businesses" },
  { to: "/growth", label: "Growth" },
  { to: "/health", label: "System health" },
  { to: "/audit-log", label: "Audit log" },
  { to: "/broadcast", label: "Broadcast" },
  { to: "/support", label: "Support" },
];

const SUPPORT_POLL_MS = 30000;

export default function AdminShell({ children }) {
  const navigate = useNavigate();
  const user = getUser();
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [unreadSupport, setUnreadSupport] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const refreshApp = () => {
    setRefreshing(true);
    window.location.reload();
  };

  useEffect(() => {
    const checkUnread = () => {
      api.get("/admin/support/threads")
        .then(({ data }) => setUnreadSupport(data.filter((t) => t.unread_by_admin).length))
        .catch(() => {});
    };
    checkUnread();
    const id = setInterval(checkUnread, SUPPORT_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const signOut = () => {
    clearToken();
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <img src="/icon-192.png" alt="Ledgerly" className="brand-mark" />
          <div>
            <div className="brand-name">Ledgerly Admin</div>
            <div className="brand-tag">Internal</div>
          </div>
        </div>
        <div className="topbar-right">
          <div className="topbar-user">
            <div>{user?.name}</div>
            <div className="topbar-user-email">{user?.email}</div>
          </div>
          <button className="btn btn-outline" onClick={refreshApp} disabled={refreshing} title="Refresh"><ArrowsClockwise size={14} className={refreshing ? "spin" : undefined} /></button>
          <button className="btn btn-outline" onClick={() => setShowSetPassword(true)}><Key size={14} /> Set password</button>
          <button className="btn btn-outline" onClick={signOut}><SignOut size={14} /> Sign out</button>
        </div>
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
            {t.label}
            {t.to === "/support" && unreadSupport > 0 && (
              <span style={{ marginLeft: "0.4rem", display: "inline-block", width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: "hsl(var(--destructive))" }} />
            )}
          </NavLink>
        ))}
      </div>
      <div className="container">{children}</div>
      <Toaster />
      {showSetPassword && <SetPasswordModal onClose={() => setShowSetPassword(false)} />}
    </div>
  );
}
