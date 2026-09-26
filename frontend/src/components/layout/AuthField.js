/**
 * A field on the sign-in pages: label, a leading icon, the control, and an
 * optional line under it.
 *
 * The icon is positioned by this wrapper rather than by PrimeReact's IconField,
 * which clones its children and breaks when one is conditional — the same trap
 * SearchBox.js documents.
 *
 * `aside` sits at the right of the label row: the place people look for
 * "Forgot password?" is next to the password, not under the button.
 */
export default function AuthField({ id, label, icon, aside, children, footer }) {
  return (
    <div className="auth-field">
      <div className="auth-field__top">
        {id ? <label htmlFor={id}>{label}</label> : <span className="auth-field__label">{label}</span>}
        {aside}
      </div>
      <div className={`auth-field__control${icon ? " has-icon" : ""}`}>
        {icon && <i className={`pi ${icon} auth-field__icon`} aria-hidden="true" />}
        {children}
      </div>
      {footer}
    </div>
  );
}

/*
 * How strong a password is, shown as it is typed.
 *
 * The only rule the server enforces is eight characters, so that is the only
 * thing that turns the meter from "too short" to acceptable. Beyond it, length
 * and a mix of character kinds raise the score — advice, not a gate, and
 * worded that way.
 */
function score(value) {
  if (!value) return 0;
  if (value.length < 8) return 1;
  let points = 1;
  if (value.length >= 12) points++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) points++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) points++;
  return Math.min(points + (value.length >= 16 ? 1 : 0), 4);
}

const LEVELS = [
  null,
  { label: "Too short — at least 8 characters", tone: "bad" },
  { label: "Fair — longer is stronger", tone: "warn" },
  { label: "Good", tone: "ok" },
  { label: "Strong", tone: "great" },
];

export function PasswordStrength({ value }) {
  const s = score(value);
  const level = LEVELS[s];

  return (
    <div className={`pw-meter${level ? ` is-${level.tone}` : ""}`} aria-live="polite">
      <div className="pw-meter__bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n <= s ? "is-on" : ""} />
        ))}
      </div>
      <small>{level ? level.label : "Use at least 8 characters. A short phrase works well."}</small>
    </div>
  );
}
