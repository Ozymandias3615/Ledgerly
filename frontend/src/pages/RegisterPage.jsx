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
import { Wallet } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", business_name: "", email: "", password: "", currency: "USD" });
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
      const payload = { ...form };
      if (inviteCode.trim()) payload.invite_code = inviteCode.trim().toUpperCase();
      await register(payload);
      toast.success("Account created");
      navigate("/dashboard");
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white grid place-items-center p-8" style={{ fontFamily: "'IBM Plex Sans', system-ui" }}>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-9 w-9 rounded-md bg-slate-900 grid place-items-center">
            <Wallet size={20} weight="fill" className="text-white" />
          </div>
          <div className="font-extrabold text-xl" style={{ fontFamily: "Manrope, sans-serif" }}>Ledgerly</div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Create account</div>
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
              <PasswordInput required value={form.password} onChange={(e) => update("password", e.target.value)} data-testid="register-password-input" />
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
            {!invitePreview && (
              <>
                <div>
                  <Label>Business name</Label>
                  <Input value={form.business_name} onChange={(e) => update("business_name", e.target.value)} data-testid="register-business-input" />
                </div>
                <div>
                  <Label>Primary currency</Label>
                  <Select value={form.currency} onValueChange={(v) => update("currency", v)}>
                    <SelectTrigger data-testid="register-currency-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {error && <div className="text-sm text-red-600" data-testid="register-error">{error}</div>}
            <Button type="submit" disabled={loading} className="w-full h-11 bg-slate-900 hover:bg-slate-800" data-testid="register-submit-button">
              {loading ? "Creating..." : "Create account"}
            </Button>
          </form>
          <div className="text-sm text-slate-600 mt-4 text-center">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold text-slate-900 underline underline-offset-4" data-testid="link-login">Sign in</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
