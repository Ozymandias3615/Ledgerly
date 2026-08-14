import { NavLink } from "react-router-dom";
import { House, Article, PiggyBank, Calendar, Target } from "@phosphor-icons/react";

const tabs = [
  { to: "/", label: "Home", Icon: House, end: true },
  { to: "/transactions", label: "Transactions", Icon: Article },
  { to: "/budgets", label: "Budgets", Icon: PiggyBank },
  { to: "/bills", label: "Bills", Icon: Calendar },
  { to: "/goals", label: "Goals", Icon: Target },
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
