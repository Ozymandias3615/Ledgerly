import { Navigate, Route, Routes } from "react-router-dom";
import LoginScreen from "./screens/LoginScreen";
import HomeScreen from "./screens/HomeScreen";
import TransactionsScreen from "./screens/TransactionsScreen";
import TransactionFormScreen from "./screens/TransactionFormScreen";
import CaptureScreen from "./screens/CaptureScreen";
import ReviewScreen from "./screens/ReviewScreen";
import BudgetsScreen from "./screens/BudgetsScreen";
import BillsScreen from "./screens/BillsScreen";
import GoalsScreen from "./screens/GoalsScreen";
import GoalDetailScreen from "./screens/GoalDetailScreen";
import SettingsScreen from "./screens/SettingsScreen";
import NotificationsScreen from "./screens/NotificationsScreen";
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
        path="/transactions"
        element={
          <RequireAuth>
            <TransactionsScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/transactions/new"
        element={
          <RequireAuth>
            <TransactionFormScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/transactions/:id/edit"
        element={
          <RequireAuth>
            <TransactionFormScreen />
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
        path="/budgets"
        element={
          <RequireAuth>
            <BudgetsScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/bills"
        element={
          <RequireAuth>
            <BillsScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/goals"
        element={
          <RequireAuth>
            <GoalsScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/goals/:id"
        element={
          <RequireAuth>
            <GoalDetailScreen />
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
      <Route
        path="/notifications"
        element={
          <RequireAuth>
            <NotificationsScreen />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to={isAuthenticated() ? "/" : "/login"} replace />} />
    </Routes>
  );
}
