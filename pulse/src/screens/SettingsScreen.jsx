import { useEffect, useState } from "react";
import { ArrowsClockwise, Bell, Check, Monitor, Moon, PencilSimple, Sun, Trash, X } from "@phosphor-icons/react";
import api from "../lib/api";
import { getUser, updateStoredUser } from "../lib/auth";
import { getStoredTheme, setTheme } from "../lib/theme";
import { addPersonalCategory, renamePersonalCategory, removePersonalCategory, usePersonalCategories, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "../lib/categories";
import { checkNeedsRetag, getPushSubscriptionState, isIosNotInstalled, subscribeToPush, unsubscribeFromPush } from "../lib/push";
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
  const [needsRetag, setNeedsRetag] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getPushSubscriptionState()
      .then((state) => {
        if (cancelled) return;
        setPushState(state);
        if (state === "subscribed") {
          checkNeedsRetag().then((needs) => {
            if (!cancelled) setNeedsRetag(needs);
          });
        }
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
        setNeedsRetag(false);
      } else {
        await subscribeToPush();
        setPushState("subscribed");
        setNeedsRetag(false);
      }
    } catch (err) {
      setError(err.message === "Permission not granted" ? "Notifications were blocked. You can allow them in your browser settings." : "Couldn't update notification settings.");
      setPushState(await getPushSubscriptionState());
    } finally {
      setPushBusy(false);
    }
  };

  const refreshPush = async () => {
    setPushBusy(true);
    setError("");
    try {
      await subscribeToPush();
      setNeedsRetag(false);
    } catch {
      setError("Couldn't refresh notification settings.");
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
      {pushState === "subscribed" && needsRetag && (
        <div className="banner banner-warning">
          Notifications here need a quick refresh so alerts go to the right app.
          <button type="button" className="btn-primary" style={{ marginTop: "0.5rem" }} onClick={refreshPush} disabled={pushBusy}>
            {pushBusy ? "Refreshing…" : "Refresh notifications"}
          </button>
        </div>
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

function CategoryGroup({ type, title, builtIns, custom }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [error, setError] = useState("");

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await addPersonalCategory(type, name);
      setName("");
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't add this category.");
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async () => {
    if (!renaming.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await renamePersonalCategory(renaming.id, renaming.name);
      setRenaming(null);
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't rename this category.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Remove ${c.name}? It won't be offered for new entries, but anything already using it keeps it.`)) return;
    setRemovingId(c.id);
    setError("");
    try {
      await removePersonalCategory(c.id);
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't remove this category.");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div className="eyebrow">{title}</div>
      <p className="list-meta" style={{ margin: "0.25rem 0 0.75rem" }}>Built in: {builtIns.join(", ")}</p>
      {custom.length > 0 && (
        <div className="list">
          {custom.map((c) =>
            renaming?.id === c.id ? (
              <div className="list-card" key={c.id} style={{ gap: "0.5rem" }}>
                <input
                  type="text"
                  autoFocus
                  maxLength={40}
                  value={renaming.name}
                  onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveRename();
                    }
                  }}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="button" className="icon-btn" aria-label="Save name" disabled={busy || !renaming.name.trim()} onClick={saveRename}>
                  <Check size={16} />
                </button>
                <button type="button" className="icon-btn" aria-label="Cancel rename" onClick={() => setRenaming(null)}>
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="list-card" key={c.id} style={{ gap: "0.5rem" }}>
                <div className="list-info">
                  <div className="list-title">{c.name}</div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Rename ${c.name}`}
                  onClick={() => {
                    setError("");
                    setRenaming({ id: c.id, name: c.name });
                  }}
                >
                  <PencilSimple size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn list-delete-btn"
                  aria-label={`Remove ${c.name}`}
                  disabled={removingId === c.id}
                  onClick={() => remove(c)}
                >
                  <Trash size={16} />
                </button>
              </div>
            )
          )}
        </div>
      )}
      <form onSubmit={add} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <input type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder={`New ${type} category`} style={{ flex: 1 }} />
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
          Add
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function CategoriesSection() {
  const custom = usePersonalCategories().custom || [];
  return (
    <>
      <CategoryGroup type="expense" title="Spending" builtIns={EXPENSE_CATEGORIES} custom={custom.filter((c) => c.type === "expense")} />
      <CategoryGroup type="income" title="Income" builtIns={INCOME_CATEGORIES} custom={custom.filter((c) => c.type === "income")} />
    </>
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
    { key: "categories", label: "Categories" },
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
      {tab === "categories" && <CategoriesSection />}
      {tab === "appearance" && <AppearanceSection />}
      {tab === "updates" && <UpdatesSection />}
    </div>
  );
}
