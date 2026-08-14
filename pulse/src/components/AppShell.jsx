import BottomNav from "./BottomNav";

export default function AppShell({ children }) {
  return (
    <div className="app-shell">
      {children}
      <BottomNav />
    </div>
  );
}
