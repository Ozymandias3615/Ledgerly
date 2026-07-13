import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, FileText, Package, Users, X } from "@phosphor-icons/react";

const TYPE_ICON = {
  invoice_created: FileText,
  invoice_status: FileText,
  inventory_low: Package,
  inventory_sold: Package,
  payroll_run: Users,
  employee_added: Users,
  employee_removed: Users,
  team_joined: Users,
};

function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications");
      setItems(data.items);
      setUnreadCount(data.unread_count);
    } catch (e) {
      // Notifications are non-critical - fail silently.
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 45000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleOpenChange = async (next) => {
    if (!next) return;
    await refresh();
    if (unreadCount > 0 || items.some((n) => !n.read)) {
      setUnreadCount(0);
      api.post("/notifications/read-all").catch(() => {});
    }
  };

  const handleClick = (n) => {
    if (n.link) navigate(n.link);
  };

  const clearAll = async (e) => {
    e.stopPropagation();
    setItems([]);
    setUnreadCount(0);
    await api.delete("/notifications").catch(() => {});
  };

  const dismiss = async (e, id) => {
    e.stopPropagation();
    setItems((prev) => prev.filter((n) => n.id !== id));
    await api.delete(`/notifications/${id}`).catch(() => {});
  };

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative h-9 w-9 grid place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
          data-testid="notification-bell"
          title="Notifications"
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold grid place-items-center leading-none"
              data-testid="notification-badge"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" data-testid="notification-panel">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="font-semibold text-sm">Notifications</div>
          {items.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-slate-400 hover:text-slate-700 transition-colors"
              data-testid="notification-clear-all"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-sm text-slate-500 text-center py-10">You're all caught up</div>
          ) : (
            items.map((n) => {
              const Icon = TYPE_ICON[n.type] || Bell;
              return (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleClick(n)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleClick(n); }}
                  className={`w-full text-left flex items-start gap-2 px-4 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer ${!n.read ? "bg-blue-50/50" : ""}`}
                  data-testid={`notification-item-${n.id}`}
                >
                  <div className="h-7 w-7 shrink-0 rounded-full bg-slate-100 grid place-items-center text-slate-500 mt-0.5">
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900">{n.title}</div>
                    {n.message && <div className="text-xs text-slate-500 mt-0.5">{n.message}</div>}
                    <div className="text-[11px] text-slate-400 mt-1">{timeAgo(n.created_at)}</div>
                  </div>
                  {!n.read && <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0 mt-1.5" />}
                  <button
                    type="button"
                    onClick={(e) => dismiss(e, n.id)}
                    className="shrink-0 h-5 w-5 grid place-items-center rounded text-slate-300 hover:text-slate-700 hover:bg-slate-200 transition-colors"
                    title="Dismiss"
                    data-testid={`notification-dismiss-${n.id}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
