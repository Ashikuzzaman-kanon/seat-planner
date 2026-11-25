"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import ProfileDialog from "./ProfileDialog";

/**
 * One profile window for the whole dashboard.
 *
 * Any name can open it (PersonLink) without each page having a dialog of its
 * own. When something in the window changes an account — restricting it,
 * lifting that — pages that list accounts are told, so they can reload
 * (`useAccountChanges`).
 */
const ProfileContext = createContext({ openProfile: () => {}, subscribe: () => () => {} });

export function ProfileProvider({ children }) {
  const [showing, setShowing] = useState(null);
  const listeners = useRef(new Set());

  const openProfile = useCallback((id) => setShowing(Number(id)), []);
  const subscribe = useCallback((listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);
  const changed = useCallback((id) => {
    for (const listener of listeners.current) listener(id);
  }, []);

  const value = useMemo(() => ({ openProfile, subscribe }), [openProfile, subscribe]);
  return (
    <ProfileContext.Provider value={value}>
      {children}
      <ProfileDialog userId={showing} onHide={() => setShowing(null)} onChanged={changed} />
    </ProfileContext.Provider>
  );
}

/** `openProfile(id)` opens the window on that account. */
export const useProfile = () => useContext(ProfileContext);

/** Run `callback(id)` whenever the profile window changes an account. */
export function useAccountChanges(callback) {
  const { subscribe } = useProfile();
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => subscribe((id) => latest.current(id)), [subscribe]);
}
