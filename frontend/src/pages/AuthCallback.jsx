import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/utils_app";
import OAuthAccountTypeChooser from "@/components/OAuthAccountTypeChooser";

export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const [msg, setMsg] = useState("Completing sign-in...");
  const [pendingOAuth, setPendingOAuth] = useState(null); // {pending_token, name} once Google confirms a brand-new account
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");
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
        if (data.pending) {
          // Brand-new Google account - ask Business vs Personal before it's created.
          setPendingOAuth(data);
          return;
        }
        setUser(data);
        navigate(data.business_id ? (data.onboarding_complete ? "/dashboard" : "/onboarding") : "/personal/dashboard", { replace: true });
      } catch (e) {
        setMsg("Sign-in failed. Redirecting...");
        setTimeout(() => navigate("/login"), 1500);
      }
    })();
    // eslint-disable-next-line
  }, []);

  const finishBusiness = async () => {
    setCompleting(true);
    setError("");
    try {
      const { data } = await api.post("/auth/google-session/complete", { pending_token: pendingOAuth.pending_token, create_business: true });
      setUser(data);
      navigate(data.onboarding_complete ? "/dashboard" : "/onboarding", { replace: true });
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setCompleting(false);
    }
  };

  const finishPersonal = async (currency) => {
    setCompleting(true);
    setError("");
    try {
      const { data } = await api.post("/auth/google-session/complete", { pending_token: pendingOAuth.pending_token, create_business: false, currency });
      setUser(data);
      navigate("/personal/dashboard", { replace: true });
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setCompleting(false);
    }
  };

  if (pendingOAuth) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-8">
        <div className="w-full max-w-md">
          {error && <div className="text-sm text-red-600 mb-4 text-center" data-testid="auth-callback-error">{error}</div>}
          <OAuthAccountTypeChooser
            name={pendingOAuth.name}
            loading={completing}
            onChooseBusiness={finishBusiness}
            onChoosePersonal={finishPersonal}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="text-slate-600 text-sm" data-testid="auth-callback-status">{msg}</div>
    </div>
  );
}
