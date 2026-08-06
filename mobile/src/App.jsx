import { Navigate, Route, Routes } from "react-router-dom";
import LoginScreen from "./screens/LoginScreen";
import CaptureScreen from "./screens/CaptureScreen";
import ReviewScreen from "./screens/ReviewScreen";
import ReceiptsScreen from "./screens/ReceiptsScreen";
import { isAuthenticated } from "./lib/auth";

function RequireAuth({ children }) {
  return isAuthenticated() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
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
      <Route path="*" element={<Navigate to={isAuthenticated() ? "/capture" : "/login"} replace />} />
    </Routes>
  );
}
