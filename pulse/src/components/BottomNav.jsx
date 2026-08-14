import { NavLink } from "react-router-dom";
import { House, Wallet, ChartPieSlice, Receipt, PiggyBank } from "@phosphor-icons/react";

const tabs = [
  { to: "/", label: "Home", Icon: House, end: true },
  { to: "/transactions", label: "Transactions", Icon: Wallet },
  { to: "/budgets", label: "Budgets", Icon: ChartPieSlice },
  { to: "/bills", label: "Bills", Icon: Receipt },
  { to: "/goals", label: "Goals", Icon: PiggyBank },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {tabs.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          {({ isActive }) => (
            <>
              <span className="bottom-nav-icon-wrap">
                <Icon size={22} weight={isActive ? "fill" : "regular"} />
              </span>
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
