import { useEffect, useState } from "react";
import { ArrowsClockwise, Bell, Check, Copy, Monitor, Moon, Sun, Trash, UserPlus } from "@phosphor-icons/react";
import api from "../lib/api";
import { getUser, updateStoredUser } from "../lib/auth";
import { getStoredTheme, setTheme } from "../lib/theme";
import { getPushSubscriptionState, isIosNotInstalled, subscribeToPush, unsubscribeFromPush } from "../lib/push";
import Brand from "../components/Brand";
import BackButton from "../components/BackButton";
import RefreshButton from "../components/RefreshButton";

function inviteStatus(inv) {
  if (inv.redeemed_at) return "redeemed";
  if (new Date(inv.expires_at) < new Date()) return "expired";
  return "pending";
}

const STATUS_LABEL = { pending: "Pending", redeemed: "Redeemed", expired: "Expired" };
const STATUS_BADGE = { pending: "status-badge-sent", redeemed: "status-badge-paid", expired: "status-badge-overdue" };
const ROLE_LABEL = { owner: "Owner", admin: "Admin", staff: "Staff" };
const THEME_OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

function ProfileSection({ user, onSaved }) {
  const [name, setName] = useState(user.name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await api.put("/users/me", { name });
      onSaved(name);
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <form onSubmit={save} className="form">
        <label>
          Email
          <input type="email" value={user.email || ""} disabled />
        </label>
        <label>
          Your name
          <input type="text" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} required />
        </label>
        {error && <p className="error-text">{error}</p>}
        {saved && !error && <p className="list-meta">Saved.</p>}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}

function NotificationsSection() {
  const [pushState, setPushState] = useState("checking");
  const [pushBusy, setPushBusy] = useState(false);
  const [error, setError] = useState("");

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

  const togglePush = async () => {
    setPushBusy(true);
    setError("");
    try {
      if (pushState === "subscribed") {
        await unsubscribeFromPush();
        setPushState("unsubscribed");
      } else {
        await subscribeToPush();
        setPushState("subscribed");
      }
    } catch (err) {
      setError(err.message === "Permission not granted" ? "Notifications were blocked. You can allow them in your browser settings." : "Couldn't update notification settings.");
      setPushState(await getPushSubscriptionState());
    } finally {
      setPushBusy(false);
    }
  };

  const pushDisabled = pushBusy || pushState === "checking" || pushState === "unsupported" || pushState === "denied";

  return (
    <>
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
      {error && <p className="error-text">{error}</p>}

      <div className="settings-row">
        <div className="settings-row-icon">
          <Bell size={18} />
        </div>
        <div className="settings-row-info">
          <div className="list-title">Push notifications</div>
          <div className="list-meta">Low stock, invoices, payroll, and team updates</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={pushState === "subscribed"}
          aria-label="Push notifications"
          className={`switch${pushState === "subscribed" ? " switch-on" : ""}`}
          disabled={pushDisabled}
          onClick={togglePush}
        >
          <span className="switch-thumb" />
        </button>
      </div>
    </>
  );
}

function AppearanceSection() {
  const [theme, setThemeState] = useState(getStoredTheme);

  const select = (value) => {
    setTheme(value);
    setThemeState(value);
  };

  return (
    <div className="list">
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <button key={value} type="button" className={`list-card${theme === value ? " theme-option-active" : ""}`} onClick={() => select(value)}>
          <div className="settings-row-icon">
            <Icon size={18} />
          </div>
          <div className="list-info">
            <div className="list-title">{label}</div>
          </div>
          {theme === value && <Check size={16} />}
        </button>
      ))}
    </div>
  );
}

function UpdatesSection() {
  return (
    <div className="settings-row">
      <div className="settings-row-icon">
        <ArrowsClockwise size={18} />
      </div>
      <div className="settings-row-info">
        <div className="list-title">Refresh app</div>
        <div className="list-meta">Use this if a recent update isn't showing up</div>
      </div>
      <RefreshButton />
    </div>
  );
}

function TeamSection() {
  const currentUser = getUser();
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState("");
  const [roleBusyId, setRoleBusyId] = useState(null);
  const [inviteRole, setInviteRole] = useState("staff");
  const [generating, setGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState(null);

  const load = async () => {
    try {
      const [m, i] = await Promise.all([api.get("/business/members"), api.get("/invites")]);
      setMembers(m.data);
      setInvites(i.data);
    } catch {
      setError("Couldn't load team info.");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeRole = async (memberId, role) => {
    setRoleBusyId(memberId);
    setError("");
    try {
      await api.put(`/business/members/${memberId}/role`, { role });
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't update that role.");
    } finally {
      setRoleBusyId(null);
    }
  };

  const generateInvite = async () => {
    setGenerating(true);
    setError("");
    try {
      await api.post("/invites", { role: inviteRole });
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't generate an invite code.");
    } finally {
      setGenerating(false);
    }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1500);
    } catch {
      setError("Couldn't copy the code.");
    }
  };

  const revoke = async (code) => {
    const prev = invites;
    setInvites((cur) => cur.filter((i) => i.code !== code));
    try {
      await api.delete(`/invites/${code}`);
    } catch {
      setError("Couldn't revoke that invite.");
      setInvites(prev);
    }
  };

  return (
    <>
      {error && <p className="error-text">{error}</p>}

      {members === null ? (
        <p className="subtitle thinking">
          <span className="thinking-dots"><span /><span /><span /></span>
          Loading
        </p>
      ) : (
        <div className="list">
          {members.map((m) => {
            const isSelf = m.user_id === currentUser?.user_id;
            const isOwner = m.role === "owner";
            return (
              <div className="list-card" key={m.user_id}>
                <div className="list-info">
                  <div className="list-title">
                    {m.name}
                    {isSelf && <span className="list-meta"> (you)</span>}
                  </div>
                  <div className="list-meta">{m.email}</div>
                </div>
                {isOwner || isSelf ? (
                  <span className="status-badge status-badge-sent">{ROLE_LABEL[m.role]}</span>
                ) : (
                  <select className="select-compact" value={m.role} disabled={roleBusyId === m.user_id} onChange={(e) => changeRole(m.user_id, e.target.value)}>
                    <option value="admin">Admin</option>
                    <option value="staff">Staff</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="card" style={{ marginTop: "0.75rem" }}>
        <div className="list-title" style={{ marginBottom: "0.625rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <UserPlus size={16} /> Invite someone
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <select className="select-compact" style={{ flex: 1 }} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
          </select>
          <button type="button" className="btn-outline" onClick={generateInvite} disabled={generating}>
            {generating ? "Generating…" : "Generate code"}
          </button>
        </div>
      </div>

      {invites.length > 0 && (
        <div className="list" style={{ marginTop: "0.75rem" }}>
          {invites.map((inv) => {
            const status = inviteStatus(inv);
            return (
              <div className="list-card" key={inv.code}>
                <div className="list-info">
                  <div className="list-title">{inv.code}</div>
                  <div className="list-meta">{ROLE_LABEL[inv.role]}</div>
                </div>
                <span className={`status-badge ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
                <button type="button" className="icon-btn" aria-label="Copy code" title="Copy code" onClick={() => copyCode(inv.code)}>
                  {copiedCode === inv.code ? <Check size={14} /> : <Copy size={14} />}
                </button>
                {status === "pending" && (
                  <button type="button" className="icon-btn list-delete-btn" aria-label="Revoke invite" title="Revoke" onClick={() => revoke(inv.code)}>
                    <Trash size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function SettingsScreen() {
  const [user, setUser] = useState(getUser());
  const isOwnerOrAdmin = user?.role === "owner" || user?.role === "admin";
  const tabs = [
    { key: "profile", label: "Profile" },
    { key: "notifications", label: "Notifications" },
    ...(isOwnerOrAdmin ? [{ key: "team", label: "Team" }] : []),
    { key: "appearance", label: "Appearance" },
    { key: "updates", label: "Check for Updates" },
  ];
  const [tab, setTab] = useState("profile");

  return (
    <div className="screen screen-narrow">
      <div className="top-row">
        <div className="top-row-left">
          <BackButton to="/" />
          <Brand compact />
        </div>
      </div>
      <div className="eyebrow">Preferences</div>
      <h2 className="heading">Settings</h2>

      <div className="settings-tabs">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={`settings-tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && <ProfileSection user={user} onSaved={(name) => setUser(updateStoredUser({ name }))} />}
      {tab === "notifications" && <NotificationsSection />}
      {tab === "team" && isOwnerOrAdmin && <TeamSection />}
      {tab === "appearance" && <AppearanceSection />}
      {tab === "updates" && <UpdatesSection />}
    </div>
  );
}
