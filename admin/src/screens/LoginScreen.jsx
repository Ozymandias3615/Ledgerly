import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import api from "../lib/api";
import { isAuthenticated, setSession, clearToken } from "../lib/auth";
import { auth } from "../lib/firebase";

// Module-level (not per-render) so React 19 StrictMode's dev-only double
// effect-invoke doesn't call google.accounts.id.initialize() twice - GIS
// isn't idempotent about that, and the second call was breaking the
// already-rendered button rather than just being a harmless no-op.
let gisInitialized = false;

export default function LoginScreen() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const googleButtonRef = useRef(null);

  useEffect(() => {
    // Google Identity Services loads asynchronously (script tag in
    // index.html) - poll briefly rather than assuming it's ready by mount.
    let cancelled = false;
    let attempts = 0;
    const tryInit = () => {
      if (cancelled) return;
      if (!window.google?.accounts?.id) {
        attempts += 1;
        if (attempts < 50) setTimeout(tryInit, 100);
        return;
      }
      if (!gisInitialized) {
        window.google.accounts.id.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          callback: handleGoogleCredential,
        });
        gisInitialized = true;
      }
      if (googleButtonRef.current) {
        // Clear before rendering - a second renderButton() call into an
        // already-populated container is what actually broke the button.
        googleButtonRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: googleButtonRef.current.offsetWidth || 280,
        });
      }
    };
    tryInit();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Both /auth/firebase-session and /auth/login succeed for any valid
  // account - the ADMIN_EMAILS allowlist is only enforced on /admin/*
  // routes, so confirm access here rather than letting an unauthorized
  // (but otherwise valid) account land on a broken, all-403 dashboard.
  const confirmAdminAccess = async () => {
    try {
      await api.get("/admin/health");
      navigate("/users");
    } catch (err) {
      clearToken();
      setError(
        err.response?.status === 403
          ? "This account isn't authorized for admin access."
          : "Couldn't verify admin access. Try again."
      );
    }
  };

  const handleGoogleCredential = async (response) => {
    setError("");
    try {
      const credential = GoogleAuthProvider.credential(response.credential);
      const result = await signInWithCredential(auth, credential);
      const firebaseIdToken = await result.user.getIdToken();
      const { data } = await api.post("/auth/firebase-session", { id_token: firebaseIdToken });
      setSession(data.token, data);
      await confirmAdminAccess();
    } catch (err) {
      clearToken();
      setError(err.response?.data?.detail || "Google sign-in failed.");
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setSession(data.token, data);
      await confirmAdminAccess();
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed. Check your email and password.");
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated()) {
    return <Navigate to="/users" replace />;
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="/icon-192.png" alt="Ledgerly" className="brand-mark" style={{ margin: "0 auto" }} />
        <div className="login-heading">Ledgerly Admin</div>
        <p className="login-sub">Sign in with an authorized account.</p>
        <div ref={googleButtonRef} className="google-btn-container" />

        <div className="or-divider">or email</div>

        <form onSubmit={handlePasswordSubmit} style={{ textAlign: "left" }}>
          <label className="field-label">Email</label>
          <input
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ marginBottom: "0.75rem" }}
          />
          <label className="field-label">Password</label>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ marginBottom: "1rem" }}
          />
          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
