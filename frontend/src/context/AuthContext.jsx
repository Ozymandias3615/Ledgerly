import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Bumped whenever page data should be re-fetched (manual refresh, or as a
  // fallback alongside business_id changing when the active business is switched).
  const [refreshNonce, setRefreshNonce] = useState(0);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (e) {
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const bumpRefresh = useCallback(async () => {
    await checkAuth();
    setRefreshNonce((n) => n + 1);
  }, [checkAuth]);

  useEffect(() => {
    // If returning from OAuth callback, skip /me and let AuthCallback handle it
    if (window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data);
    return data;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    setUser(data);
    return data;
  };

  const loginWithFirebaseToken = async (idToken) => {
    const { data } = await api.post("/auth/firebase-session", { id_token: idToken });
    setUser(data);
    return data;
  };

  const logout = async () => {
    await api.post("/auth/logout");
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, loginWithFirebaseToken, refresh: checkAuth, bumpRefresh, refreshNonce, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
