import { Navigate, Route, Routes } from "react-router-dom";
import LoginScreen from "./screens/LoginScreen";
import HomeScreen from "./screens/HomeScreen";
import CaptureScreen from "./screens/CaptureScreen";
import ReviewScreen from "./screens/ReviewScreen";
import ReceiptsScreen from "./screens/ReceiptsScreen";
import InventoryScreen from "./screens/InventoryScreen";
import InventoryItemFormScreen from "./screens/InventoryItemFormScreen";
import InvoicesScreen from "./screens/InvoicesScreen";
import InvoiceDetailScreen from "./screens/InvoiceDetailScreen";
import NotificationsScreen from "./screens/NotificationsScreen";
import SettingsScreen from "./screens/SettingsScreen";
import { isAuthenticated } from "./lib/auth";

function RequireAuth({ children }) {
  return isAuthenticated() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <HomeScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/capture"
        element={
          <RequireAuth>
            <CaptureScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/review"
        element={
          <RequireAuth>
            <ReviewScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/receipts"
        element={
          <RequireAuth>
            <ReceiptsScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/inventory"
        element={
          <RequireAuth>
            <InventoryScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/inventory/new"
        element={
          <RequireAuth>
            <InventoryItemFormScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/inventory/:id/edit"
        element={
          <RequireAuth>
            <InventoryItemFormScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/invoices"
        element={
          <RequireAuth>
            <InvoicesScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/invoices/:id"
        element={
          <RequireAuth>
            <InvoiceDetailScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/notifications"
        element={
          <RequireAuth>
            <NotificationsScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsScreen />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to={isAuthenticated() ? "/" : "/login"} replace />} />
    </Routes>
  );
}
