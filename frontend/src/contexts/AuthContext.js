"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import api, {
  setTokens,
  clearTokens,
  getToken,
  getRefreshToken,
  setSessionExpiredHandler,
  setFeatureUnavailableHandler,
} from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  // Tabs switched off for this person (Settings → Features): [{ key, message }].
  const [unavailableFeatures, setUnavailableFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const lastLoad = useRef(0);
  // Set when the session could not be checked because the server did not
  // answer — as opposed to answering "not signed in".
  const [unreachable, setUnreachable] = useState(null);

  const clearSession = useCallback(() => {
    clearTokens();
    setUser(null);
    setRoles([]);
    setPermissions([]);
    setUnavailableFeatures([]);
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
    lastLoad.current = Date.now();
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setRoles(data.roles || []);
      setPermissions(data.permissions || []);
      setUnavailableFeatures(data.unavailableFeatures || []);
      setUnreachable(null);
    } catch (err) {
      // Only the server saying "no" ends the session. A server that is asleep,
      // restarting or out of reach says nothing about it, so the tokens are
      // kept and the page offers to try again instead of signing you out.
      if (err.status === 401 || err.status === 403) {
        clearSession();
        setUnreachable(null);
      } else {
        setUnreachable(err.message || "The server could not be reached.");
      }
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
      setUnavailableFeatures([]);
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  /*
   * Switches change while pages are open. The server refuses a switched-off
   * tab at once; the menu catches up when the server says so, when the window
   * is looked at again, and on moving between pages (at most every 20 seconds).
   */
  const recheck = useCallback(() => {
    if (Date.now() - lastLoad.current < 20_000) return;
    if (getToken() || getRefreshToken()) loadMe();
  }, [loadMe]);

  useEffect(() => {
    setFeatureUnavailableHandler(() => {
      if (getToken() || getRefreshToken()) loadMe();
    });
    const onLook = () => document.visibilityState === "visible" && recheck();
    window.addEventListener("focus", onLook);
    document.addEventListener("visibilitychange", onLook);
    return () => {
      setFeatureUnavailableHandler(null);
      window.removeEventListener("focus", onLook);
      document.removeEventListener("visibilitychange", onLook);
    };
  }, [loadMe, recheck]);

  /** Adopt a session response from login or email verification. */
  const adoptSession = useCallback((data) => {
    setTokens(data);
    setUser(data.user);
    setRoles(data.roles || []);
    setPermissions(data.permissions || []);
    setUnavailableFeatures(data.unavailableFeatures || []);
    lastLoad.current = Date.now();
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

  /** Whether a tab is on for this person. Settings has no switch and is always on. */
  const isAvailable = useCallback(
    (feature) => !feature || !unavailableFeatures.some((f) => f.key === feature),
    [unavailableFeatures]
  );

  /** The message the super admin left for a tab switched off, if any. */
  const featureMessage = useCallback(
    (feature) => unavailableFeatures.find((f) => f.key === feature)?.message || null,
    [unavailableFeatures]
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
    unreachable,
    login,
    logout,
    adoptSession,
    refresh: loadMe,
    recheck,
    unavailableFeatures,
    isAvailable,
    featureMessage,
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
