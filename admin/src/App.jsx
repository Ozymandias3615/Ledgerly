import { Navigate, Route, Routes } from "react-router-dom";
import LoginScreen from "./screens/LoginScreen";
import UsersScreen from "./screens/UsersScreen";
import BusinessesScreen from "./screens/BusinessesScreen";
import GrowthScreen from "./screens/GrowthScreen";
import HealthScreen from "./screens/HealthScreen";
import AuditLogScreen from "./screens/AuditLogScreen";
import BroadcastScreen from "./screens/BroadcastScreen";
import AdminShell from "./components/AdminShell";
import { isAuthenticated } from "./lib/auth";

function RequireAuth({ children }) {
  return isAuthenticated() ? <AdminShell>{children}</AdminShell> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/users" element={<RequireAuth><UsersScreen /></RequireAuth>} />
      <Route path="/businesses" element={<RequireAuth><BusinessesScreen /></RequireAuth>} />
      <Route path="/growth" element={<RequireAuth><GrowthScreen /></RequireAuth>} />
      <Route path="/health" element={<RequireAuth><HealthScreen /></RequireAuth>} />
      <Route path="/audit-log" element={<RequireAuth><AuditLogScreen /></RequireAuth>} />
      <Route path="/broadcast" element={<RequireAuth><BroadcastScreen /></RequireAuth>} />
      <Route path="*" element={<Navigate to={isAuthenticated() ? "/users" : "/login"} replace />} />
    </Routes>
  );
}
