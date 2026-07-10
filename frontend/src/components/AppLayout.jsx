import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { House, Receipt, FileText, Users, ChartLine, Sparkle, Gear, SignOut, Wallet } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import BusinessSwitcher from "@/components/BusinessSwitcher";
import RefreshButton from "@/components/RefreshButton";

const nav = [
  { to: "/dashboard", label: "Dashboard", Icon: House, testId: "nav-dashboard" },
  { to: "/transactions", label: "Bookkeeping", Icon: Receipt, testId: "nav-transactions" },
  { to: "/invoices", label: "Invoices", Icon: FileText, testId: "nav-invoices" },
  { to: "/payroll", label: "Payroll", Icon: Users, testId: "nav-payroll" },
  { to: "/reports", label: "Reports", Icon: ChartLine, testId: "nav-reports" },
  { to: "/insights", label: "AI Insights", Icon: Sparkle, testId: "nav-insights" },
];

export default function AppLayout({ children }) {
  const { user, logout, refreshNonce } = useAuth();
  const navigate = useNavigate();
  const visibleNav = nav.filter((item) => item.to !== "/payroll" || user?.role !== "staff");
  // Remounts the routed page whenever the active business changes (automatic
  // refresh) or the manual refresh button is clicked, so every page re-fetches
  // its data instead of showing stale content from the previous business.
  const pageKey = `${user?.business_id || "none"}:${refreshNonce}`;

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="h-screen bg-white text-slate-900 flex overflow-hidden" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col" data-testid="sidebar">
        <div className="shrink-0 px-6 py-6 border-b border-slate-200">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-8 w-8 rounded-md bg-slate-900 grid place-items-center">
              <Wallet size={18} weight="fill" className="text-white" />
            </div>
            <div className="font-extrabold tracking-tight text-lg" style={{ fontFamily: "Manrope, sans-serif" }}>Ledgerly</div>
          </div>
          <BusinessSwitcher />
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-6 space-y-1">
          {visibleNav.map(({ to, label, Icon, testId }) => (
            <NavLink
              key={to}
              to={to}
              data-testid={testId}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-200 ${
                  isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                }`
              }
            >
              <Icon size={18} weight="duotone" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="shrink-0 p-4 border-t border-slate-200">
          <div className="mb-3">
            <div className="text-sm font-semibold truncate" data-testid="user-name">{user?.name}</div>
            <div className="text-xs text-slate-500 truncate">{user?.email}</div>
          </div>
          <NavLink
            to="/settings"
            data-testid="nav-settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 mb-1 rounded-md text-sm font-medium transition-colors duration-200 ${
                isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              }`
            }
          >
            <Gear size={18} weight="duotone" />
            Settings
          </NavLink>
          <Button variant="outline" size="sm" className="w-full" onClick={handleLogout} data-testid="logout-button">
            <SignOut size={16} className="mr-2" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto flex flex-col">
        <div className="shrink-0 h-14 border-b border-slate-200 flex items-center justify-end px-6 sticky top-0 bg-white/90 backdrop-blur z-10">
          <RefreshButton />
        </div>
        <div key={pageKey} className="flex-1 min-h-0">{children}</div>
      </main>
    </div>
  );
}
