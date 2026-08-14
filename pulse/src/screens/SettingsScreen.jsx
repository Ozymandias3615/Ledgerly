import { useEffect, useState } from "react";
import { ArrowsClockwise, Bell, Check, Monitor, Moon, Sun } from "@phosphor-icons/react";
import api from "../lib/api";
import { getUser, updateStoredUser } from "../lib/auth";
import { getStoredTheme, setTheme } from "../lib/theme";
import { getPushSubscriptionState, isIosNotInstalled, subscribeToPush, unsubscribeFromPush } from "../lib/push";
import Brand from "../components/Brand";
import BackButton from "../components/BackButton";
import RefreshButton from "../components/RefreshButton";

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
            ? "To get push notifications on iPhone, add LedgerlyPulse to your home screen first (Share → Add to Home Screen), then reopen it from there."
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
          <div className="list-meta">Bill reminders and updates</div>
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

export default function SettingsScreen() {
  const [user, setUser] = useState(getUser());
  const tabs = [
    { key: "profile", label: "Profile" },
    { key: "notifications", label: "Notifications" },
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
      {tab === "appearance" && <AppearanceSection />}
      {tab === "updates" && <UpdatesSection />}
    </div>
  );
}
