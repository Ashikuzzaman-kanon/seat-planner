"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, {
  setTokens,
  clearTokens,
  getToken,
  getRefreshToken,
  setSessionExpiredHandler,
} from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(() => {
    clearTokens();
    setUser(null);
    setRoles([]);
    setPermissions([]);
  }, []);

  /**
   * Re-reads the caller's access from the server. Worth doing on every mount:
   * permissions are resolved server-side per request, so a role revoked while
   * the tab was open shows up here rather than lingering in stale local state.
   */
  const loadMe = useCallback(async () => {
    if (!getToken() && !getRefreshToken()) {
      clearSession();
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setRoles(data.roles || []);
      setPermissions(data.permissions || []);
    } catch {
      clearSession();
    } finally {
      setLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    // The api layer calls this when a refresh fails and the session is gone.
    setSessionExpiredHandler(() => {
      setUser(null);
      setRoles([]);
      setPermissions([]);
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  /** Adopt a session response from login or email verification. */
  const adoptSession = useCallback((data) => {
    setTokens(data);
    setUser(data.user);
    setRoles(data.roles || []);
    setPermissions(data.permissions || []);
    setLoading(false);
    return data.user;
  }, []);

  const login = useCallback(
    async (email, password) => {
      const { data } = await api.post("/auth/login", { email, password });
      return adoptSession(data);
    },
    [adoptSession]
  );

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    // Revoke server-side so the session can't be resumed; local state is
    // cleared either way.
    if (refreshToken) {
      try {
        await api.post("/auth/logout", { refreshToken });
      } catch {
        /* the session is ending regardless */
      }
    }
    clearSession();
  }, [clearSession]);

  const hasPermission = useCallback((perm) => permissions.includes(perm), [permissions]);

  const hasAnyPermission = useCallback(
    (...perms) => perms.some((p) => permissions.includes(p)),
    [permissions]
  );

  /** Roles are dynamic now, so this matches by name against everything held. */
  const hasRole = useCallback(
    (...names) => roles.some((r) => names.includes(r.name)),
    [roles]
  );

  const value = {
    user,
    roles,
    permissions,
    loading,
    login,
    logout,
    adoptSession,
    refresh: loadMe,
    hasPermission,
    hasAnyPermission,
    hasRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
