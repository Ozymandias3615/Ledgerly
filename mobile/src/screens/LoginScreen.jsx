import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { setSession } from "../lib/auth";
import Brand from "../components/Brand";
import ThemeToggle from "../components/ThemeToggle";

export default function LoginScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
