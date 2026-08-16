import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCIES } from "@/lib/utils_app";
import { Wallet } from "@phosphor-icons/react";

// Shown after a first-time Google/Firebase sign-in succeeds but before the
// account is actually created - lets the person choose Business vs Personal,
// same choice /register offers, before a business gets created behind them.
export default function OAuthAccountTypeChooser({ name, onChooseBusiness, onChoosePersonal, loading }) {
  const [mode, setMode] = useState("choice"); // "choice" | "personal"
  const [currency, setCurrency] = useState("USD");

  if (mode === "personal") {
    return (
      <div className="w-full max-w-sm">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Ledgerly Personal</div>
        <h3 className="text-xl font-extrabold tracking-tight mt-1 mb-4" style={{ fontFamily: "Manrope, sans-serif" }}>One more thing</h3>
        <Label>Preferred currency</Label>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger data-testid="oauth-personal-currency-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-3 mt-4">
          <Button onClick={() => onChoosePersonal(currency)} disabled={loading} data-testid="oauth-personal-confirm-button">
            {loading ? "Creating..." : "Finish setup"}
          </Button>
          <button type="button" onClick={() => setMode("choice")} className="text-sm text-slate-500 underline underline-offset-4 hover:text-slate-700">
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Welcome, {name}</div>
      <h3 className="text-xl font-extrabold tracking-tight mt-1 mb-4" style={{ fontFamily: "Manrope, sans-serif" }}>How will you use Ledgerly?</h3>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onChooseBusiness}
          disabled={loading}
          className="group min-h-[170px] flex flex-col items-center justify-center gap-3 p-5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-lg hover:-translate-y-1 active:translate-y-0 active:shadow-sm transition-all duration-200 ease-out text-center disabled:opacity-60"
          data-testid="oauth-choose-business-button"
        >
          <div className="h-12 w-12 rounded-xl bg-primary grid place-items-center shrink-0 transition-transform duration-200 ease-out group-hover:scale-110">
            <Wallet size={24} weight="fill" className="text-primary-foreground" />
          </div>
          <div className="font-bold" style={{ fontFamily: "Manrope, sans-serif" }}>Ledgerly Business</div>
        </button>
        <button
          type="button"
          onClick={() => setMode("personal")}
          disabled={loading}
          className="group min-h-[170px] flex flex-col items-center justify-center gap-3 p-5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-lg hover:-translate-y-1 active:translate-y-0 active:shadow-sm transition-all duration-200 ease-out text-center disabled:opacity-60"
          data-testid="oauth-choose-personal-button"
        >
          <div className="h-12 w-12 rounded-xl bg-primary grid place-items-center shrink-0 transition-transform duration-200 ease-out group-hover:scale-110">
            <Wallet size={24} weight="fill" className="text-primary-foreground" />
          </div>
          <div className="font-bold" style={{ fontFamily: "Manrope, sans-serif" }}>Ledgerly Personal</div>
        </button>
      </div>
    </div>
  );
}
