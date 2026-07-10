import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { formatApiError } from "@/lib/utils_app";
import { Wallet, GoogleLogo } from "@phosphor-icons/react";
import { toast } from "sonner";
import { auth } from "@/lib/firebase";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";

export default function LoginPage() {
  const { login, loginWithFirebaseToken } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@ledgerly.com");
  const [password, setPassword] = useState("Admin@12345");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email, password);
      toast.success("Welcome back");
      navigate("/dashboard");
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const googleLogin = async () => {
    if (!window.electronAPI) {
      setError("Google sign-in is only available in the desktop app.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const googleIdToken = await window.electronAPI.googleSignIn();
      const credential = GoogleAuthProvider.credential(googleIdToken);
      const result = await signInWithCredential(auth, credential);
      const firebaseIdToken = await result.user.getIdToken();
      await loginWithFirebaseToken(firebaseIdToken);
      toast.success("Welcome back");
      navigate("/dashboard");
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-white" style={{ fontFamily: "'IBM Plex Sans', system-ui" }}>
      <div className="hidden lg:flex flex-col justify-between p-12 bg-slate-950 text-white relative overflow-hidden">
        <div className="flex items-center gap-3 relative z-10">
          <div className="h-10 w-10 rounded-md bg-white grid place-items-center">
            <Wallet size={22} weight="fill" className="text-slate-900" />
          </div>
          <div className="font-extrabold text-2xl tracking-tight" style={{ fontFamily: "Manrope, sans-serif" }}>Ledgerly</div>
        </div>
        <div className="relative z-10 space-y-4">
          <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight" style={{ fontFamily: "Manrope, sans-serif" }}>
            Automated bookkeeping <br />built for growth.
          </h1>
          <p className="text-slate-300 text-base max-w-md">
            Track cash flow, run payroll, send invoices and generate tax-ready reports — all in one workspace with AI-powered insights.
          </p>
          <div className="pt-6 grid grid-cols-3 gap-4">
            {["Cash Flow", "Payroll", "Tax Reports"].map((t) => (
              <div key={t} className="border border-slate-800 rounded-md p-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Module</div>
                <div className="text-sm font-semibold mt-1">{t}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs text-slate-500 relative z-10">© Ledgerly — Business Finance OS</div>
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
      </div>

      <div className="flex items-center justify-center p-8 lg:p-16">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Sign in</div>
            <h2 className="text-3xl font-extrabold tracking-tight mt-1" style={{ fontFamily: "Manrope, sans-serif" }}>Welcome back</h2>
            <p className="text-sm text-slate-500 mt-2">Enter your credentials or continue with Google.</p>
          </div>

          <Card className="p-6 shadow-none border-slate-200">
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 mb-4"
              onClick={googleLogin}
              disabled={loading}
              data-testid="google-login-button"
            >
              <GoogleLogo size={18} weight="bold" className="mr-2" /> Continue with Google
            </Button>
            <div className="flex items-center gap-3 my-4">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">or email</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" data-testid="login-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" data-testid="login-password-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && <div className="text-sm text-red-600" data-testid="login-error">{error}</div>}
              <Button type="submit" disabled={loading} data-testid="login-submit-button" className="w-full h-11 bg-slate-900 hover:bg-slate-800">
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
            <div className="text-sm text-slate-600 mt-4 text-center">
              New here?{" "}
              <Link to="/register" className="font-semibold text-slate-900 underline underline-offset-4" data-testid="link-register">Create an account</Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
