"use client";

import { useProfile } from "./ProfileProvider";
import "./people.css";

/**
 * A person's name that opens their profile.
 *
 * Used wherever the name of an account is shown. Without an `id` — a name
 * from somewhere that is not an account, or the system — it is plain text, so
 * callers never have to check first.
 */
export default function PersonLink({ id, name, children, className = "" }) {
  const { openProfile } = useProfile();
  const label = children ?? name;
  if (!id) return <span className={className}>{label}</span>;
  return (
    <button
      type="button"
      className={`person-link${className ? ` ${className}` : ""}`}
      onClick={(e) => {
        // A name inside a clickable row opens the person, not the row.
        e.stopPropagation();
        openProfile(id);
      }}
      title="Open profile"
    >
      {label}
    </button>
  );
}
