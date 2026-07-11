import React from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { House, Receipt, FileText, Users, ChartLine, Sparkle, Gear, SignOut, Wallet, Question } from "@phosphor-icons/react";
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

// A NavLink whose active background is a single shared element (layoutId):
// when the active tab changes, framer-motion animates that pill sliding from
// its old position to the new one instead of the highlight just snapping.
function NavItem({ to, label, Icon, testId, className = "" }) {
  return (
    <NavLink
      to={to}
      data-testid={testId}
      className={({ isActive }) =>
        `relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-150 ${
          isActive ? "text-white" : "text-slate-700 hover:bg-slate-100"
        } ${className}`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.div
              layoutId="nav-active-pill"
              className="absolute inset-0 bg-slate-900 rounded-md"
              transition={{ type: "spring", stiffness: 500, damping: 34 }}
            />
          )}
          <Icon size={18} weight="duotone" className="relative shrink-0" />
          <span className="relative">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function AppLayout({ children }) {
  const { user, logout, refreshNonce } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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
            <NavItem key={to} to={to} label={label} Icon={Icon} testId={testId} />
          ))}
        </nav>
        <div className="shrink-0 p-4 border-t border-slate-200">
          <div className="mb-3">
            <div className="text-sm font-semibold truncate" data-testid="user-name">{user?.name}</div>
            <div className="text-xs text-slate-500 truncate">{user?.email}</div>
          </div>
          <NavItem to="/help" label="Help" Icon={Question} testId="nav-help" className="mb-1" />
          <NavItem to="/settings" label="Settings" Icon={Gear} testId="nav-settings" className="mb-1" />
          <Button variant="outline" size="sm" className="w-full" onClick={handleLogout} data-testid="logout-button">
            <SignOut size={16} className="mr-2" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto flex flex-col">
        <div className="shrink-0 h-14 border-b border-slate-200 flex items-center justify-end px-6 sticky top-0 bg-white/90 backdrop-blur z-10">
          <RefreshButton />
        </div>
        <motion.div
          key={`${location.pathname}:${pageKey}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex-1 min-h-0 flex flex-col"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
