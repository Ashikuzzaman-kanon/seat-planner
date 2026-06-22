"use client";

import { useAuth } from "@/contexts/AuthContext";

/**
 * Renders children only if the current user holds the required permission.
 * Optionally renders a fallback (e.g. an "access denied" card) otherwise.
 */
export default function PermissionGate({ permission, fallback = null, children }) {
  const { hasPermission } = useAuth();
  return hasPermission(permission) ? children : fallback;
}
