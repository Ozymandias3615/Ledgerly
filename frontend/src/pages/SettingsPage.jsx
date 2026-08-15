import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTheme, THEMES } from "@/context/ThemeContext";
import { CURRENCIES, formatApiError, exportAndDownload } from "@/lib/utils_app";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import { Copy, Trash, UserPlus, UploadSimple, Image as ImageIcon, Sparkle, Check, ArrowsClockwise } from "@phosphor-icons/react";
import { toast } from "sonner";

// Matches AppLayout's main nav: a single shared element (layoutId) slides
// between tabs instead of the active background just snapping into place.
function SettingsTab({ value, label, active, testId }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      data-testid={testId}
      className={`relative px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 ${
        active ? "text-primary-foreground" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {active && (
        <motion.div
          layoutId="settings-tab-active-pill"
          className="absolute inset-0 bg-primary rounded-md"
          transition={{ type: "spring", stiffness: 500, damping: 34 }}
        />
      )}
      <span className="relative">{label}</span>
    </TabsPrimitive.Trigger>
  );
}

function TabPanel({ title, subtitle, children, testId }) {
  return (
    <Card className="border-slate-200 shadow-none max-w-lg p-6" data-testid={testId}>
      <div className="mb-5">
        <div className="font-bold text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>{title}</div>
        {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
      </div>
      {children}
    </Card>
  );
}

export function LogoUploader({ user, refresh, editable }) {
  const fileInputRef = React.useRef(null);
  const [uploading, setUploading] = useState(false);
  const logoSrc = user?.logo_data ? `data:${user.logo_content_type};base64,${user.logo_data}` : null;

  const pickFile = () => fileInputRef.current?.click();

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await api.post("/business/logo", formData);
      await refresh();
      toast.success("Logo uploaded");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    try {
      await api.delete("/business/logo");
      await refresh();
      toast.success("Logo removed");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="flex items-center gap-4 mb-5">
      <div className="h-16 w-16 rounded-md border border-slate-200 grid place-items-center overflow-hidden bg-slate-50 shrink-0">
        {logoSrc ? (
          <img src={logoSrc} alt="Business logo" className="h-full w-full object-contain" data-testid="business-logo-preview" />
        ) : (
          <ImageIcon size={22} className="text-slate-300" />
        )}
      </div>
      {editable && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-slate-500">Shown on your PDF exports (invoices, reports, and more). PNG/JPEG/WEBP, up to 1MB.</div>
          <div className="flex gap-2">
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={upload} data-testid="business-logo-input" />
            <Button type="button" variant="outline" size="sm" onClick={pickFile} disabled={uploading} data-testid="business-logo-upload-button">
              <UploadSimple size={14} className="mr-2" /> {uploading ? "Uploading..." : logoSrc ? "Replace logo" : "Upload logo"}
            </Button>
            {logoSrc && (
              <Button type="button" variant="outline" size="sm" onClick={remove} data-testid="business-logo-remove-button">
                <Trash size={14} className="mr-2" /> Remove
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AiKeySection({ user, refresh }) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await api.put("/business/ai-key", { api_key: apiKey.trim() });
      await refresh();
      setApiKey("");
      toast.success("API key saved");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.delete("/business/ai-key");
      await refresh();
      toast.success("API key removed");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="mt-6 pt-5 border-t border-slate-100">
      <div className="text-xs uppercase tracking-[0.15em] text-slate-500 mb-2 flex items-center gap-1.5">
        <Sparkle size={12} weight="fill" /> AI Insights
      </div>
      <div className="text-xs text-slate-500 mb-3">
        Powers the AI Insights page. Works out of the box on a small shared daily quota. For unlimited use,
        add your own free Groq API key (from{" "}
        <span className="font-medium">console.groq.com/keys</span>) — usage then bills to that account, not Ledgerly.
        {user?.has_ai_key && <span className="text-emerald-700 dark:text-emerald-400 font-medium"> Your own API key is currently configured.</span>}
      </div>
      <form onSubmit={save} className="flex gap-2">
        <PasswordInput
          placeholder={user?.has_ai_key ? "Enter a new key to replace it" : "Your Groq API key"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="max-w-xs"
          data-testid="ai-key-input"
        />
        <Button type="submit" variant="outline" size="sm" disabled={saving || !apiKey.trim()} data-testid="ai-key-save-button">
          {saving ? "Saving..." : "Save"}
        </Button>
        {user?.has_ai_key && (
          <Button type="button" variant="outline" size="sm" onClick={remove} data-testid="ai-key-remove-button">
            <Trash size={14} className="mr-2" /> Remove
          </Button>
        )}
      </form>
    </div>
  );
}

function ProfileSection({ user, refresh }) {
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/users/me", { name });
      await refresh();
      toast.success("Profile saved");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <Label htmlFor="settings-email">Email</Label>
        <Input id="settings-email" value={user?.email || ""} disabled data-testid="settings-email-input" />
      </div>
      <div>
        <Label htmlFor="settings-name">Your name</Label>
        <Input id="settings-name" required value={name} onChange={(e) => setName(e.target.value)} data-testid="settings-name-input" />
      </div>
      <Button type="submit" disabled={saving} data-testid="settings-save-button">
        {saving ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}

function BusinessSection({ user, refresh }) {
  const canEdit = user?.role === "owner" || user?.role === "admin";
  const [form, setForm] = useState({ name: user?.business_name || "", currency: user?.currency || "USD", invoice_reminder_days: user?.invoice_reminder_days || 7 });
  const [saving, setSaving] = useState(false);
  const [relabeling, setRelabeling] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/business", form);
      await refresh();
      toast.success("Business updated");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const [confirmRelabel, setConfirmRelabel] = useState(false);
  const relabelCurrency = async () => {
    setConfirmRelabel(false);
    setRelabeling(true);
    try {
      await api.post("/business/relabel-currency");
      toast.success(`All existing records relabeled to ${user?.currency}`);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setRelabeling(false);
    }
  };

  if (!canEdit) {
    return (
      <>
        <LogoUploader user={user} refresh={refresh} editable={false} />
        <div className="space-y-3 text-sm">
          <div><span className="text-slate-500">Name</span><div className="font-medium" data-testid="settings-business-readonly">{user?.business_name}</div></div>
          <div><span className="text-slate-500">Currency</span><div className="font-medium">{user?.currency}</div></div>
        </div>
      </>
    );
  }

  return (
    <>
      <LogoUploader user={user} refresh={refresh} editable={true} />
      <form onSubmit={save} className="space-y-4">
        <div>
          <Label htmlFor="settings-business">Business name</Label>
          <Input id="settings-business" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} data-testid="settings-business-input" />
        </div>
        <div>
          <Label>Primary currency</Label>
          <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
            <SelectTrigger data-testid="settings-currency-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="settings-invoice-reminder-days">Overdue invoice reminders</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 shrink-0">Remind me every</span>
            <Input
              id="settings-invoice-reminder-days"
              type="number"
              min={1}
              max={90}
              required
              className="w-20"
              value={form.invoice_reminder_days}
              onChange={(e) => setForm((f) => ({ ...f, invoice_reminder_days: Number(e.target.value) }))}
              data-testid="settings-invoice-reminder-days-input"
            />
            <span className="text-sm text-slate-500 shrink-0">days an invoice is overdue</span>
          </div>
        </div>
        <Button type="submit" disabled={saving} data-testid="settings-business-save-button">
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </form>

      <div className="mt-6 pt-5 border-t border-slate-100">
        <div className="text-xs uppercase tracking-[0.15em] text-slate-500 mb-2">Existing records</div>
        <div className="text-xs text-slate-500 mb-3">
          Transactions, invoices, employees, and payslips each keep the currency they were created with.
          If you only ever use one currency, you can relabel all of them to match your current setting
          ({user?.currency}) &mdash; this only changes the currency shown, it does not convert amounts.
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmRelabel(true)} disabled={relabeling} data-testid="relabel-currency-button">
          {relabeling ? "Relabeling..." : `Relabel existing records to ${user?.currency}`}
        </Button>
      </div>

      <AiKeySection user={user} refresh={refresh} />

      <ConfirmDialog
        open={confirmRelabel}
        onOpenChange={setConfirmRelabel}
        title="Relabel all existing records?"
        description={`This will change the currency label on every existing transaction, invoice, employee, and payslip to ${user?.currency} — it only relabels the currency, it does not convert the amounts.`}
        confirmLabel="Relabel"
        destructive={false}
        onConfirm={relabelCurrency}
      />
    </>
  );
}

function TeamSection() {
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [role, setRole] = useState("staff");
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    const [m, i] = await Promise.all([api.get("/business/members"), api.get("/invites")]);
    setMembers(m.data);
    setInvites(i.data);
  };
  useEffect(() => { load(); }, []);

  const changeRole = async (memberId, newRole) => {
    try {
      await api.put(`/business/members/${memberId}/role`, { role: newRole });
      toast.success("Role updated");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      await api.post("/invites", { role });
      toast.success("Invite code generated");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setGenerating(false);
    }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    toast.success("Code copied");
  };

  const revoke = async (code) => {
    try {
      await api.delete(`/invites/${code}`);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const inviteStatus = (inv) => {
    if (inv.redeemed_at) return "Redeemed";
    if (new Date(inv.expires_at) < new Date()) return "Expired";
    return "Pending";
  };

  return (
    <>
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.15em] text-slate-500 mb-2">Members</div>
        <div className="space-y-2">
          {members.map((m) => {
            const isSelf = m.user_id === user?.user_id;
            const isOwner = m.role === "owner";
            return (
              <div key={m.user_id} className="flex items-center justify-between gap-3 text-sm border-b border-slate-100 pb-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{m.name}{isSelf && <span className="text-xs text-slate-400 font-normal"> (you)</span>}</div>
                  <div className="text-xs text-slate-500 truncate">{m.email}</div>
                </div>
                {isOwner || isSelf ? (
                  <span className="text-xs uppercase tracking-wide text-slate-500 shrink-0">{m.role}</span>
                ) : (
                  <Select value={m.role} onValueChange={(v) => changeRole(m.user_id, v)}>
                    <SelectTrigger className="w-28 h-8 text-xs shrink-0" data-testid={`member-role-${m.user_id}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="staff">Staff</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.15em] text-slate-500 mb-2">Invite someone</div>
        <div className="flex gap-2">
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-32" data-testid="invite-role-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="staff">Staff</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={generate} disabled={generating} data-testid="generate-invite-button">
            <UserPlus size={16} className="mr-2" /> Generate code
          </Button>
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-[0.15em] text-slate-500 mb-2">Invite codes</div>
        {invites.length === 0 ? (
          <div className="text-sm text-slate-500">No invites yet.</div>
        ) : (
          <div className="space-y-2">
            {invites.map((inv) => (
              <div key={inv.code} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2">
                <div>
                  <div className="font-mono font-semibold">{inv.code}</div>
                  <div className="text-xs text-slate-500">{inv.role} — {inviteStatus(inv)}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button className="p-1.5 hover:bg-slate-100 rounded text-slate-500" onClick={() => copyCode(inv.code)} title="Copy code">
                    <Copy size={16} />
                  </button>
                  {inviteStatus(inv) === "Pending" && (
                    <button className="p-1.5 hover:bg-slate-100 rounded text-red-600" onClick={() => revoke(inv.code)} title="Revoke">
                      <Trash size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function DataAccountSection() {
  const { user, setUser } = useAuth();
  const needsPassword = user?.auth_provider === "password";
  const [password, setPassword] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      await exportAndDownload(
        async () => (await api.get("/account/export", { responseType: "blob" })).data,
        "ledgerly-export.zip",
      );
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api.delete("/account", { data: needsPassword ? { password } : {} });
      toast.success("Your account has been deleted");
      setUser(false);
    } catch (err) {
      toast.error(formatApiError(err));
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.15em] text-slate-500 mb-2">Export your data</div>
        <div className="text-xs text-slate-500 mb-3">
          {user?.business_name ? (
            <>Download everything in {user.business_name} — transactions, invoices, clients, inventory, employees,
            and payroll — plus your Ledgerly Personal transactions, budgets, bills, and savings goals — as a ZIP of
            CSV files.</>
          ) : (
            <>Download your Ledgerly Personal transactions, budgets, bills, and savings goals as a ZIP of CSV files.</>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={exportData} disabled={exporting} data-testid="export-account-data-button">
          {exporting ? "Preparing export..." : "Export my data"}
        </Button>
      </div>

      <div className="pt-5 border-t border-slate-100">
        <div className="text-xs uppercase tracking-[0.15em] text-red-600 mb-2">Danger zone</div>
        <div className="text-xs text-slate-500 mb-3">
          Permanently delete your account{user?.role === "owner"
            ? " — if you're the only member of your business, its data is deleted too; otherwise transfer ownership or remove other members first"
            : ""}. This can't be undone.
        </div>
        {needsPassword && (
          <div className="mb-3 max-w-xs">
            <Label htmlFor="delete-account-password">Confirm your password</Label>
            <PasswordInput
              id="delete-account-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="delete-account-password-input"
            />
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-red-200 text-red-600 hover:bg-red-50"
          onClick={() => setConfirmOpen(true)}
          disabled={needsPassword && !password}
          data-testid="delete-account-button"
        >
          <Trash size={14} className="mr-2" /> Delete my account
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete your account?"
        description="This permanently deletes your account. If you own a business with other members, you'll need to transfer ownership or remove them first."
        confirmLabel={deleting ? "Deleting..." : "Delete account"}
        onConfirm={deleteAccount}
      />
    </>
  );
}

const THEME_PREVIEWS = {
  light: { bg: "#ffffff", primary: "#0a0a0f" },
  dark: { bg: "#141a22", primary: "#eef4fb" },
  ocean: { bg: "#eaf4fc", primary: "#1257cf" },
  grey: { bg: "#e4e5e8", primary: "#37393f" },
  sage: { bg: "#f6f8f2", primary: "#2f6f4e" },
  amber: { bg: "#fdf6ec", primary: "#b5651d" },
  violet: { bg: "#f5f3fb", primary: "#5b46a8" },
  indigo: { bg: "#eef1fc", primary: "#3644a6" },
  rose: { bg: "#fdf0f4", primary: "#b3436b" },
};

function AppearanceSection() {
  const { theme, setTheme, customColors, setCustomColors } = useTheme();
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {THEMES.map((t) => {
          const preview = t.value === "custom" ? customColors : THEME_PREVIEWS[t.value];
          const active = theme === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTheme(t.value)}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                active ? "border-primary ring-1 ring-primary" : "border-slate-200 hover:bg-slate-50"
              }`}
              data-testid={`theme-option-${t.value}`}
            >
              <span
                className="h-8 w-8 rounded-full shrink-0 border border-slate-200"
                style={{ background: `linear-gradient(135deg, ${preview.background ?? preview.bg} 50%, ${preview.primary} 50%)` }}
              />
              <span className="flex-1 text-sm font-medium">{t.label}</span>
              {active && <Check size={16} className="text-primary" weight="bold" />}
            </button>
          );
        })}
      </div>

      {theme === "custom" && (
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="color"
              value={customColors.background}
              onChange={(e) => setCustomColors({ ...customColors, background: e.target.value })}
              className="h-8 w-8 rounded border border-slate-200 cursor-pointer"
              data-testid="custom-theme-background-input"
            />
            Background
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="color"
              value={customColors.primary}
              onChange={(e) => setCustomColors({ ...customColors, primary: e.target.value })}
              className="h-8 w-8 rounded border border-slate-200 cursor-pointer"
              data-testid="custom-theme-primary-input"
            />
            Accent
          </label>
        </div>
      )}
    </div>
  );
}

function DesktopSection() {
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setVersion);
  }, []);

  const check = async () => {
    setChecking(true);
    try {
      await window.electronAPI.checkForUpdates();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-slate-500">Version {version || "…"}</div>
      <Button type="button" variant="outline" size="sm" onClick={check} disabled={checking} data-testid="check-updates-button">
        <ArrowsClockwise size={14} className="mr-2" /> {checking ? "Checking..." : "Check for Updates"}
      </Button>
    </div>
  );
}

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const isOwnerOrAdmin = user?.role === "owner" || user?.role === "admin";
  const [tab, setTab] = useState("profile");

  return (
    <div className="p-8 space-y-4" data-testid="settings-page">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Account</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Settings</h1>
        <div className="text-sm text-slate-500 mt-1">Your profile, business, and team</div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsPrimitive.List data-testid="settings-tabs" className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
          <SettingsTab value="profile" label="Profile" active={tab === "profile"} testId="tab-profile" />
          <SettingsTab value="business" label="Business" active={tab === "business"} testId="tab-business" />
          {isOwnerOrAdmin && <SettingsTab value="team" label="Team" active={tab === "team"} testId="tab-team" />}
          <SettingsTab value="appearance" label="Appearance" active={tab === "appearance"} testId="tab-appearance" />
          <SettingsTab value="data" label="Data & Account" active={tab === "data"} testId="tab-data" />
          {window.electronAPI && <SettingsTab value="desktop" label="Check for Updates" active={tab === "desktop"} testId="tab-desktop" />}
        </TabsPrimitive.List>

        <TabsContent value="profile" className="mt-6">
          <TabPanel title="Your profile" subtitle={user?.email} testId="settings-profile-section">
            <ProfileSection user={user} refresh={refresh} />
          </TabPanel>
        </TabsContent>

        <TabsContent value="business" className="mt-6">
          <TabPanel title="Business" subtitle={user?.business_name} testId="settings-business-section">
            <BusinessSection user={user} refresh={refresh} />
          </TabPanel>
        </TabsContent>

        {isOwnerOrAdmin && (
          <TabsContent value="team" className="mt-6">
            <TabPanel title="Team" subtitle="Members, roles & invites" testId="settings-team-section">
              <TeamSection />
            </TabPanel>
          </TabsContent>
        )}

        <TabsContent value="appearance" className="mt-6">
          <TabPanel title="Appearance" subtitle="Theme" testId="settings-appearance-section">
            <AppearanceSection />
          </TabPanel>
        </TabsContent>

        <TabsContent value="data" className="mt-6">
          <TabPanel title="Data & Account" subtitle="Export or delete your account" testId="settings-danger-section">
            <DataAccountSection />
          </TabPanel>
        </TabsContent>

        {window.electronAPI && (
          <TabsContent value="desktop" className="mt-6">
            <TabPanel title="Check for Updates" subtitle="Version & updates" testId="settings-desktop-section">
              <DesktopSection />
            </TabPanel>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
