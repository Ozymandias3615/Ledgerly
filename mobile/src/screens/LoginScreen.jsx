import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRedirectResult, signInWithRedirect } from "firebase/auth";
import api from "../lib/api";
import { setSession } from "../lib/auth";
import { auth, googleProvider } from "../lib/firebase";
import Brand from "../components/Brand";
import ThemeToggle from "../components/ThemeToggle";

export default function LoginScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resumingGoogle, setResumingGoogle] = useState(true);

  useEffect(() => {
    getRedirectResult(auth)
      .then(async (result) => {
        if (!result) return;
        const idToken = await result.user.getIdToken();
        const { data } = await api.post("/auth/firebase-session", { id_token: idToken });
        setSession(data.token, data);
        navigate("/capture");
      })
      .catch((err) => {
        setError(err.response?.data?.detail || "Google sign-in failed. Try again.");
      })
      .finally(() => setResumingGoogle(false));
  }, [navigate]);

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

  const handleGoogleSignIn = () => {
    setError("");
    signInWithRedirect(auth, googleProvider);
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

      <button type="button" className="btn-outline btn-google" onClick={handleGoogleSignIn} disabled={resumingGoogle}>
        <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
          <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
          <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
          <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
        </svg>
        Continue with Google
      </button>

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
