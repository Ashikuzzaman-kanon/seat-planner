"use client";

/**
 * Pick one of a few, as chips.
 *
 * Used where the choices have to wrap on a phone — a segmented button splits
 * across lines with half its borders missing; chips are separate, so they wrap
 * without looking broken.
 */
export default function Chips({ options, value, onChange, ariaLabel, className = "" }) {
  return (
    <div className={`sub-chips${className ? ` ${className}` : ""}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={on}
            className={`sub-chip${on ? " is-on" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
