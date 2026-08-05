import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import api from "../lib/api";
import { setSession } from "../lib/auth";
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
      // Mirrors the desktop app's flow exactly (see frontend/src/pages/LoginPage.jsx):
      // wrap the Google ID token in a Firebase credential, sign into Firebase
      // client-side, then hand the resulting *Firebase* ID token to the backend -
      // this bypasses Firebase's own signInWithRedirect entirely, which is what
      // was silently failing to resolve inside the installed home-screen PWA.
      const credential = GoogleAuthProvider.credential(response.credential);
      const result = await signInWithCredential(auth, credential);
      const firebaseIdToken = await result.user.getIdToken();
      const { data } = await api.post("/auth/firebase-session", { id_token: firebaseIdToken });
      setSession(data.token, data);
      navigate("/capture");
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
      navigate("/capture");
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed. Check your email and password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screen screen-center">
      <div className="top-row">
        <Brand />
        <ThemeToggle />
      </div>
      <div className="eyebrow">Sign in</div>
      <h2 className="heading">Welcome back</h2>
      <p className="subtitle">Log in with your Ledgerly account to capture receipts on the go.</p>

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
