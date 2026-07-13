import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCIES, formatApiError } from "@/lib/utils_app";
import { Wallet } from "@phosphor-icons/react";
import { toast } from "sonner";
import { LogoUploader } from "@/pages/SettingsPage";

export default function OnboardingPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState(user?.business_name || "");
  const [currency, setCurrency] = useState(user?.currency || "USD");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const finish = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/business", { name: businessName.trim() || user?.business_name, currency });
      if (apiKey.trim()) await api.put("/business/ai-key", { api_key: apiKey.trim() });
      await api.post("/business/complete-onboarding");
      await refresh();
      toast.success("You're all set up");
      navigate("/dashboard");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    setSaving(true);
    try {
      await api.put("/business", { name: user?.business_name, currency });
      await api.post("/business/complete-onboarding");
      await refresh();
      navigate("/dashboard");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
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
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Welcome</div>
        <h2 className="text-3xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Let's set up your business</h2>
        <p className="text-sm text-slate-500 mt-2 mb-6">
          Business name, your logo, and an AI key are optional — you can always add or change them later in Settings.
        </p>

        <Card className="p-6 border-slate-200 shadow-none">
          <form onSubmit={finish} className="space-y-5">
            <div>
              <Label>Business logo</Label>
              <div className="mt-1">
                <LogoUploader user={user} refresh={refresh} editable />
              </div>
            </div>
            <div>
              <Label>Business name</Label>
              <Input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder={user?.business_name}
                data-testid="onboarding-business-name-input"
              />
            </div>
            <div>
              <Label>Default currency <span className="text-red-600">*</span></Label>
              <Select value={currency} onValueChange={setCurrency} required>
                <SelectTrigger data-testid="onboarding-currency-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-slate-400 mt-1">Every transaction, invoice, and payslip defaults to this currency.</div>
            </div>
            <div>
              <Label>Gemini API key</Label>
              <PasswordInput
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Optional — powers unlimited AI Insights"
                data-testid="onboarding-ai-key-input"
              />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={saving} className="bg-slate-900 hover:bg-slate-800" data-testid="onboarding-finish-button">
                {saving ? "Saving..." : "Finish setup"}
              </Button>
              <button
                type="button"
                onClick={skip}
                disabled={saving}
                className="text-sm text-slate-500 underline underline-offset-4 hover:text-slate-700"
                data-testid="onboarding-skip-button"
              >
                Skip for now
              </button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
