import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, ChartPieSlice, Receipt, PiggyBank, CaretRight, SignOut } from "@phosphor-icons/react";
import api from "../lib/api";
import { clearToken, getUser } from "../lib/auth";
import { fmtAmount } from "../lib/format";
import Brand from "../components/Brand";
import ThemeToggle from "../components/ThemeToggle";
import AppShell from "../components/AppShell";

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const modules = [
  { to: "/transactions", label: "Transactions", subtitle: "Log your income and spending", Icon: Wallet },
  { to: "/budgets", label: "Budgets", subtitle: "See where you stand", Icon: ChartPieSlice },
  { to: "/bills", label: "Bills", subtitle: "Upcoming bills", Icon: Receipt },
  { to: "/goals", label: "Goals", subtitle: "Track your progress", Icon: PiggyBank },
];

export default function HomeScreen() {
  const navigate = useNavigate();
  const user = getUser();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/personal/transactions")
      .then(({ data }) => {
        if (cancelled) return;
        const monthKey = currentMonthKey();
        const thisMonth = data.filter((tx) => tx.date?.slice(0, 7) === monthKey);
        const income = thisMonth.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        const expense = thisMonth.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        setSummary({ income, expense, net: income - expense });
      })
      // Silent failure - the summary is a nice-to-have glance, not worth an
      // error banner on the screen every screen re-enters through.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = () => {
    clearToken();
    navigate("/login");
  };

  return (
    <AppShell>
      <div className="screen screen-narrow">
        <div className="top-row">
          <Brand />
          <ThemeToggle />
        </div>
        <div className="eyebrow">Welcome</div>
        <h2 className="heading">{user?.name || "Hi there"}</h2>
        <p className="subtitle">Signed in as {user?.email}</p>

        {summary && (
          <div className="stat-grid">
            <div className="stat-tile">
              <div className={`stat-value ${summary.net < 0 ? "stat-negative" : "stat-positive"}`}>{fmtAmount(Math.abs(summary.net), user?.currency)}</div>
              <div className="stat-label">This month</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value stat-positive">{fmtAmount(summary.income, user?.currency)}</div>
              <div className="stat-label">Income</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value stat-negative">{fmtAmount(summary.expense, user?.currency)}</div>
              <div className="stat-label">Expenses</div>
            </div>
          </div>
        )}

        <div className="module-grid">
          {modules.map(({ to, label, subtitle, Icon }) => (
            <button key={to} type="button" className="module-card" onClick={() => navigate(to)}>
              <div className="module-card-icon">
                <Icon size={22} weight="duotone" />
              </div>
              <div className="module-card-info">
                <div className="list-title">{label}</div>
                <div className="list-meta">{subtitle}</div>
              </div>
              <CaretRight size={16} className="module-card-chevron" />
            </button>
          ))}
        </div>

        <button type="button" className="btn-outline" onClick={handleLogout} style={{ marginTop: "1.5rem" }}>
          <SignOut size={16} style={{ marginRight: "0.5rem" }} /> Log out
        </button>
      </div>
    </AppShell>
  );
}
