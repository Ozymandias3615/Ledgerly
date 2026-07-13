import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCIES, formatApiError } from "@/lib/utils_app";
import { Copy, Trash, UserPlus, UploadSimple, Image as ImageIcon, Sparkle, CaretDown } from "@phosphor-icons/react";
import { toast } from "sonner";

function Section({ title, subtitle, defaultOpen = false, children, testId }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="border-slate-200 shadow-none max-w-lg overflow-hidden" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors"
      >
        <span>
          <span className="font-bold text-lg block" style={{ fontFamily: "Manrope, sans-serif" }}>{title}</span>
          {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
        </span>
        <CaretDown size={16} className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-6 pb-6 pt-1">{children}</div>}
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
        add your own free Gemini API key (from{" "}
        <span className="font-medium">aistudio.google.com/apikey</span>) — usage then bills to that account, not Ledgerly.
        {user?.has_ai_key && <span className="text-emerald-700 font-medium"> Your own API key is currently configured.</span>}
      </div>
      <form onSubmit={save} className="flex gap-2">
        <PasswordInput
          placeholder={user?.has_ai_key ? "Enter a new key to replace it" : "Your Gemini API key"}
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
      <Button type="submit" disabled={saving} className="bg-slate-900 hover:bg-slate-800" data-testid="settings-save-button">
        {saving ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}

function BusinessSection({ user, refresh }) {
  const canEdit = user?.role === "owner" || user?.role === "admin";
  const [form, setForm] = useState({ name: user?.business_name || "", currency: user?.currency || "USD" });
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

  const relabelCurrency = async () => {
    if (!window.confirm(
      `This will change the currency label on every existing transaction, invoice, employee, and payslip to ${user?.currency} ` +
      `- it only relabels the currency, it does not convert the amounts. Continue?`
    )) return;
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
        <Button type="submit" disabled={saving} className="bg-slate-900 hover:bg-slate-800" data-testid="settings-business-save-button">
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
        <Button type="button" variant="outline" size="sm" onClick={relabelCurrency} disabled={relabeling} data-testid="relabel-currency-button">
          {relabeling ? "Relabeling..." : `Relabel existing records to ${user?.currency}`}
        </Button>
      </div>

      <AiKeySection user={user} refresh={refresh} />
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
          <Button onClick={generate} disabled={generating} className="bg-slate-900 hover:bg-slate-800" data-testid="generate-invite-button">
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

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const isOwnerOrAdmin = user?.role === "owner" || user?.role === "admin";

  return (
    <div className="p-8 space-y-4" data-testid="settings-page">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Account</div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Settings</h1>
        <div className="text-sm text-slate-500 mt-1">Your profile, business, and team</div>
      </div>

      <Section title="Your profile" subtitle={user?.email} defaultOpen testId="settings-profile-section">
        <ProfileSection user={user} refresh={refresh} />
      </Section>
      <Section title="Business" subtitle={user?.business_name} testId="settings-business-section">
        <BusinessSection user={user} refresh={refresh} />
      </Section>
      {isOwnerOrAdmin && (
        <Section title="Team" subtitle="Members, roles & invites" testId="settings-team-section">
          <TeamSection />
        </Section>
      )}
    </div>
  );
}
