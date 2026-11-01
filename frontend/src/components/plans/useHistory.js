"use client";

import { useCallback, useRef, useState } from "react";

const LIMIT = 100;
const MERGE_MS = 800;

/**
 * A value with undo and redo — the seat plan's layout. Every change is a step
 * back; typing into one field is one step, not one per key: changes with the
 * same `tag` close together are merged. `reset` starts afresh (a plan loaded).
 */
export default function useHistory(initial) {
  const [state, setState] = useState(() => ({ past: [], present: initial, future: [] }));
  const last = useRef({ tag: null, at: 0 });

  const set = useCallback((update, tag = null) => {
    const now = Date.now();
    const merge = Boolean(tag) && last.current.tag === tag && now - last.current.at < MERGE_MS;
    last.current = { tag, at: now };
    setState((s) => {
      const next = typeof update === "function" ? update(s.present) : update;
      if (next === s.present) return s;
      return { past: merge ? s.past : [...s.past, s.present].slice(-LIMIT), present: next, future: [] };
    });
  }, []);

  const reset = useCallback((value) => {
    last.current = { tag: null, at: 0 };
    setState({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    last.current = { tag: null, at: 0 };
    setState((s) =>
      s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s
    );
  }, []);

  const redo = useCallback(() => {
    last.current = { tag: null, at: 0 };
    setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  }, []);

  return {
    value: state.present,
    set,
    reset,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
