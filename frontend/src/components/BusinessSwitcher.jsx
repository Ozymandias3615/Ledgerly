import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CaretUpDown, Check, Plus, UserPlus } from "@phosphor-icons/react";
import { CURRENCIES, formatApiError } from "@/lib/utils_app";
import { toast } from "sonner";

export default function BusinessSwitcher() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCurrency, setNewCurrency] = useState("USD");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/memberships");
      setMemberships(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(); }, [open]);

  const switchTo = async (businessId) => {
    if (businessId === user?.business_id && user?.active_context === "business") { setOpen(false); return; }
    try {
      await api.post("/memberships/switch", { business_id: businessId });
      if (user?.active_context !== "business") {
        await api.post("/context/switch", { context: "business" });
      }
      await refresh();
      toast.success("Switched business");
      setOpen(false);
      navigate("/dashboard");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const switchToPersonal = async () => {
    if (user?.active_context === "personal") { setOpen(false); return; }
    try {
      await api.post("/context/switch", { context: "personal" });
      await refresh();
      toast.success("Switched to Personal");
      setOpen(false);
      navigate("/personal/dashboard");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const join = async () => {
    if (!inviteCode.trim()) return;
    setJoining(true);
    try {
      await api.post("/invites/redeem", { code: inviteCode.trim().toUpperCase() });
      await refresh();
      toast.success("Joined business");
      setInviteCode("");
      setOpen(false);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setJoining(false);
    }
  };

  const createBusiness = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post("/businesses", { name: newName.trim(), currency: newCurrency });
      await refresh();
      toast.success("Business created");
      setNewName("");
      setNewCurrency("USD");
      setCreateOpen(false);
      setOpen(false);
      navigate("/dashboard");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-2 w-full text-left hover:bg-slate-100 rounded-md px-1.5 py-1 -mx-1.5 transition-colors"
          data-testid="business-switcher-trigger"
        >
          <div className="min-w-0 flex-1">
            <div className="font-extrabold tracking-tight text-lg truncate" style={{ fontFamily: "Manrope, sans-serif" }}>
              {user?.active_context === "personal" ? "Personal" : user?.business_name}
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
              {user?.active_context === "personal" ? "Personal Finance" : "Business Finance"}
            </div>
          </div>
          <CaretUpDown size={14} className="text-slate-400 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2" data-testid="business-switcher-menu">
        <div className="mb-2 pb-2 border-b border-slate-100">
          <button
            onClick={switchToPersonal}
            className="w-full flex items-center justify-between text-left px-2 py-1.5 rounded-md text-sm hover:bg-slate-100"
            data-testid="switch-context-personal"
          >
            <span className="flex items-center gap-2 min-w-0">
              {user?.active_context === "personal" && <Check size={14} className="text-emerald-600 shrink-0" />}
              <span className="truncate">Personal</span>
            </span>
          </button>
        </div>
        <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 px-2 py-1">Your businesses</div>
        <div className="space-y-0.5 mb-2">
          {loading ? (
            <div className="text-sm text-slate-400 px-2 py-1.5">Loading...</div>
          ) : memberships.map((m) => (
            <button
              key={m.business_id}
              onClick={() => switchTo(m.business_id)}
              className="w-full flex items-center justify-between text-left px-2 py-1.5 rounded-md text-sm hover:bg-slate-100"
              data-testid={`switch-business-${m.business_id}`}
            >
              <span className="flex items-center gap-2 min-w-0">
                {m.active && user?.active_context === "business" && <Check size={14} className="text-emerald-600 shrink-0" />}
                <span className="truncate">{m.business_name}</span>
              </span>
              <span className="text-xs text-slate-400 uppercase tracking-wide shrink-0 ml-2">{m.role}</span>
            </button>
          ))}
          <button
            onClick={() => { setOpen(false); setCreateOpen(true); }}
            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-sm text-slate-600 hover:bg-slate-100"
            data-testid="open-create-business-button"
          >
            <Plus size={14} className="shrink-0" />
            <span>Create a business</span>
          </button>
        </div>
        <div className="border-t border-slate-100 pt-2">
          <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 px-2 py-1">Join another business</div>
          <div className="flex gap-1.5 px-2">
            <Input
              placeholder="Invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="h-8 text-sm"
              data-testid="switcher-invite-input"
            />
            <Button size="sm" onClick={join} disabled={joining} data-testid="switcher-join-button">
              <UserPlus size={14} />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Create a business</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Business name</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Beezy & Partners"
              data-testid="create-business-name-input"
            />
          </div>
          <div>
            <Label>Default currency</Label>
            <Select value={newCurrency} onValueChange={setNewCurrency}>
              <SelectTrigger data-testid="create-business-currency-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={createBusiness} disabled={creating || !newName.trim()} data-testid="create-business-submit-button">
            {creating ? "Creating..." : "Create business"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
