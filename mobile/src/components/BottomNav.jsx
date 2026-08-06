import { NavLink } from "react-router-dom";
import { House, Receipt, Package, FileText } from "@phosphor-icons/react";

const tabs = [
  { to: "/", label: "Home", Icon: House, end: true },
  { to: "/receipts", label: "Receipts", Icon: Receipt },
  { to: "/inventory", label: "Inventory", Icon: Package },
  { to: "/invoices", label: "Invoices", Icon: FileText },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {tabs.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          {({ isActive }) => (
            <>
              <Icon size={22} weight={isActive ? "fill" : "regular"} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
