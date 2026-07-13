import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const [msg, setMsg] = useState("Completing sign-in...");
  const processed = React.useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const hash = location.hash || window.location.hash;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const sessionId = params.get("session_id");
    if (!sessionId) {
      navigate("/login");
      return;
    }
    (async () => {
      try {
        const { data } = await api.post("/auth/google-session", { session_id: sessionId });
        setUser(data);
        navigate(data.onboarding_complete ? "/dashboard" : "/onboarding", { replace: true });
      } catch (e) {
        setMsg("Sign-in failed. Redirecting...");
        setTimeout(() => navigate("/login"), 1500);
      }
    })();
    // eslint-disable-next-line
  }, []);

  return (
    <div className="min-h-screen grid place-items-center bg-white">
      <div className="text-slate-600 text-sm" data-testid="auth-callback-status">{msg}</div>
    </div>
  );
}
