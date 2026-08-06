import { useNavigate } from "react-router-dom";
import { Receipt, Package, FileText, SignOut, CaretRight } from "@phosphor-icons/react";
import { clearToken, getUser } from "../lib/auth";
import Brand from "../components/Brand";
import ThemeToggle from "../components/ThemeToggle";
import RefreshButton from "../components/RefreshButton";
import AppShell from "../components/AppShell";

const modules = [
  { to: "/receipts", label: "Receipts", subtitle: "Capture and review expenses", Icon: Receipt },
  { to: "/inventory", label: "Inventory", subtitle: "Track stock and low-stock alerts", Icon: Package },
  { to: "/invoices", label: "Invoices", subtitle: "Create invoices and update status", Icon: FileText },
];

export default function HomeScreen() {
  const navigate = useNavigate();
  const user = getUser();

  const handleLogout = () => {
    clearToken();
    navigate("/login");
  };

  return (
    <AppShell>
      <div className="screen screen-narrow">
        <div className="top-row">
          <Brand />
          <div className="top-row-left">
            <RefreshButton />
            <ThemeToggle />
          </div>
        </div>
        <div className="eyebrow">Welcome</div>
        <h2 className="heading">{user?.name || "Hi there"}</h2>
        <p className="subtitle">Signed in as {user?.email}</p>

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
