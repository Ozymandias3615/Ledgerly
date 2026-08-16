import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCIES, formatApiError } from "@/lib/utils_app";
import { ArrowLeft, Wallet } from "@phosphor-icons/react";
import { toast } from "sonner";

function LedgerlyMark() {
  return (
    <div className="flex items-center gap-2 mb-6">
      <div className="h-9 w-9 rounded-md bg-primary grid place-items-center">
        <Wallet size={20} weight="fill" className="text-primary-foreground" />
      </div>
      <div className="font-extrabold text-xl" style={{ fontFamily: "Manrope, sans-serif" }}>Ledgerly</div>
    </div>
  );
}

function ChooseAccountType({ onChoose }) {
  return (
    <div className="w-full max-w-3xl">
      <LedgerlyMark />
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Create account</div>
      <h2 className="text-3xl font-extrabold tracking-tight mt-1 mb-6" style={{ fontFamily: "Manrope, sans-serif" }}>How will you use Ledgerly?</h2>

      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => onChoose("business")}
          className="group min-h-[260px] flex flex-col items-center justify-center gap-4 p-8 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-lg hover:-translate-y-1 active:translate-y-0 active:shadow-sm transition-all duration-200 ease-out text-center"
          data-testid="choose-business-button"
        >
          <div className="h-20 w-20 rounded-2xl bg-primary grid place-items-center shrink-0 transition-transform duration-200 ease-out group-hover:scale-110">
            <Wallet size={40} weight="fill" className="text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-xl" style={{ fontFamily: "Manrope, sans-serif" }}>Ledgerly Business</div>
            <div className="text-sm text-slate-500 mt-2">Bookkeeping, invoices, and inventory.</div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onChoose("personal")}
          className="group min-h-[260px] flex flex-col items-center justify-center gap-4 p-8 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-lg hover:-translate-y-1 active:translate-y-0 active:shadow-sm transition-all duration-200 ease-out text-center"
          data-testid="choose-personal-button"
        >
          <div className="h-20 w-20 rounded-2xl bg-primary grid place-items-center shrink-0 transition-transform duration-200 ease-out group-hover:scale-110">
            <Wallet size={40} weight="fill" className="text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-xl" style={{ fontFamily: "Manrope, sans-serif" }}>Ledgerly Personal</div>
            <div className="text-sm text-slate-500 mt-2">Budgets, bills, and savings goals.</div>
          </div>
        </button>
      </div>

      <div className="text-sm text-slate-600 mt-6 text-center">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-slate-900 underline underline-offset-4" data-testid="link-login">Sign in</Link>
      </div>
    </div>
  );
}

function BackLink({ onBack }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4"
      data-testid="register-back-button"
    >
      <ArrowLeft size={14} /> Choose a different account type
    </button>
  );
}

function BusinessRegisterForm({ onBack }) {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [inviteCode, setInviteCode] = useState("");
  const [invitePreview, setInvitePreview] = useState(null);
  const [inviteError, setInviteError] = useState("");
  const [checkingInvite, setCheckingInvite] = useState(false);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const checkInvite = async () => {
    const code = inviteCode.trim();
    if (!code) { setInvitePreview(null); setInviteError(""); return; }
    setCheckingInvite(true);
    setInviteError("");
    try {
      const { data } = await api.get(`/invites/preview/${encodeURIComponent(code.toUpperCase())}`);
      setInvitePreview(data);
    } catch (err) {
      setInvitePreview(null);
      setInviteError("Invalid or expired invite code");
    } finally {
      setCheckingInvite(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload = { ...form, create_business: true };
      if (inviteCode.trim()) payload.invite_code = inviteCode.trim().toUpperCase();
      const user = await register(payload);
      toast.success("Account created");
      navigate(user.onboarding_complete ? "/dashboard" : "/onboarding");
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <LedgerlyMark />
      <BackLink onBack={onBack} />
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Ledgerly Business</div>
      <h2 className="text-3xl font-extrabold tracking-tight mt-1 mb-6" style={{ fontFamily: "Manrope, sans-serif" }}>Start managing your books</h2>

      <Card className="p-6 border-slate-200 shadow-none">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Your name</Label>
            <Input required value={form.name} onChange={(e) => update("name", e.target.value)} data-testid="register-name-input" />
          </div>
          <div>
            <Label>Email</Label>
            <Input required type="email" value={form.email} onChange={(e) => update("email", e.target.value)} data-testid="register-email-input" />
          </div>
          <div>
            <Label>Password</Label>
            <PasswordInput required minLength={8} value={form.password} onChange={(e) => update("password", e.target.value)} data-testid="register-password-input" />
            <div className="text-xs text-slate-400 mt-1">At least 8 characters</div>
          </div>
          <div>
            <Label>Invite code (optional)</Label>
            <Input
              placeholder="Have a code from your team? Enter it here"
              value={inviteCode}
              onChange={(e) => { setInviteCode(e.target.value); setInvitePreview(null); setInviteError(""); }}
              onBlur={checkInvite}
              data-testid="register-invite-input"
            />
            {checkingInvite && <div className="text-xs text-slate-400 mt-1">Checking code...</div>}
            {invitePreview && (
              <div className="text-xs text-emerald-700 mt-1" data-testid="register-invite-preview">
                Joining <strong>{invitePreview.business_name}</strong> as {invitePreview.role}
              </div>
            )}
            {inviteError && <div className="text-xs text-red-600 mt-1">{inviteError}</div>}
          </div>
          {error && <div className="text-sm text-red-600" data-testid="register-error">{error}</div>}
          <Button type="submit" disabled={loading} className="w-full h-11" data-testid="register-submit-button">
            {loading ? "Creating..." : "Create account"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function PersonalRegisterForm({ onBack }) {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const user = await register({ ...form, create_business: false, currency });
      toast.success("Account created");
      navigate(user.business_id ? "/dashboard" : "/personal/dashboard");
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <LedgerlyMark />
      <BackLink onBack={onBack} />
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Ledgerly Personal</div>
      <h2 className="text-3xl font-extrabold tracking-tight mt-1 mb-6" style={{ fontFamily: "Manrope, sans-serif" }}>Set up your personal budget</h2>

      <Card className="p-6 border-slate-200 shadow-none">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Your name</Label>
            <Input required value={form.name} onChange={(e) => update("name", e.target.value)} data-testid="register-personal-name-input" />
          </div>
          <div>
            <Label>Email</Label>
            <Input required type="email" value={form.email} onChange={(e) => update("email", e.target.value)} data-testid="register-personal-email-input" />
          </div>
          <div>
            <Label>Password</Label>
            <PasswordInput required minLength={8} value={form.password} onChange={(e) => update("password", e.target.value)} data-testid="register-personal-password-input" />
            <div className="text-xs text-slate-400 mt-1">At least 8 characters</div>
          </div>
          <div>
            <Label>Preferred currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger data-testid="register-personal-currency-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <div className="text-sm text-red-600" data-testid="register-error">{error}</div>}
          <Button type="submit" disabled={loading} className="w-full h-11" data-testid="register-submit-button">
            {loading ? "Creating..." : "Create account"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function RegisterPage() {
  const [mode, setMode] = useState("choice"); // "choice" | "business" | "personal"

  return (
    <div className="min-h-screen bg-background grid place-items-center p-8" style={{ fontFamily: "'IBM Plex Sans', system-ui" }}>
      {mode === "choice" && <ChooseAccountType onChoose={setMode} />}
      {mode === "business" && <BusinessRegisterForm onBack={() => setMode("choice")} />}
      {mode === "personal" && <PersonalRegisterForm onBack={() => setMode("choice")} />}
    </div>
  );
}
