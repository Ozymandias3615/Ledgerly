import { NavLink } from "react-router-dom";
import { House, Receipt, Package, FileText } from "@phosphor-icons/react";
import { useUnreadCount } from "../lib/notifications";

const tabs = [
  { to: "/", label: "Home", Icon: House, end: true },
  { to: "/receipts", label: "Receipts", Icon: Receipt },
  { to: "/inventory", label: "Inventory", Icon: Package },
  { to: "/invoices", label: "Invoices", Icon: FileText },
];

export default function BottomNav() {
  const unreadCount = useUnreadCount();

  return (
    <nav className="bottom-nav">
      {tabs.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          {({ isActive }) => (
            <>
              <span className="bottom-nav-icon-wrap">
                <Icon size={22} weight={isActive ? "fill" : "regular"} />
                {to === "/" && unreadCount > 0 && <span className="bottom-nav-dot" />}
              </span>
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
