import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import api from "../lib/api";
import { isAuthenticated, setSession } from "../lib/auth";
import { auth } from "../lib/firebase";
import Brand from "../components/Brand";
import ThemeToggle from "../components/ThemeToggle";

export default function LoginScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
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
      window.google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
      });
      if (googleButtonRef.current) {
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: googleButtonRef.current.offsetWidth || 320,
        });
      }
    };
    tryInit();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogleCredential = async (response) => {
    setError("");
    try {
      const credential = GoogleAuthProvider.credential(response.credential);
      const result = await signInWithCredential(auth, credential);
      const firebaseIdToken = await result.user.getIdToken();
      const { data } = await api.post("/auth/firebase-session", { id_token: firebaseIdToken });
      setSession(data.token, data);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.detail || "Google sign-in failed. Try again.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setSession(data.token, data);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed. Check your email and password.");
    } finally {
      setLoading(false);
    }
  };

  // The installed PWA's start_url always lands here on relaunch, so without
  // this check a user with a perfectly valid stored session would see the
  // login form every time they reopen the app and re-authenticate for no
  // reason.
  if (isAuthenticated()) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="screen screen-center">
      <div className="top-row">
        <Brand />
        <ThemeToggle />
      </div>
      <div className="eyebrow">Sign in</div>
      <h2 className="heading">Welcome back</h2>
      <p className="subtitle">Log in with your Ledgerly account to track your personal finances.</p>

      <div ref={googleButtonRef} className="google-btn-container" />

      <div className="divider">
        <span>or email</span>
      </div>

      <form onSubmit={handleSubmit} className="form">
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
