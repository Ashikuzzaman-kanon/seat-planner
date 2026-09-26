/**
 * How an icon-only button explains itself on hover.
 *
 * Every button that is only an icon carries a tooltip with these options and
 * an `aria-label` with the same words — the tooltip for people with a mouse,
 * the label for screen readers, which never see a tooltip.
 *
 * `showOnDisabled`: most of these buttons are disabled for someone without
 * the permission, and a disabled button fires no mouse events, so without it
 * the tooltip would vanish exactly when the button is most puzzling.
 */
export const TIP = { position: "top", showDelay: 200, showOnDisabled: true };

/** Spread onto a PrimeReact Button: `<Button icon="pi pi-trash" {...tip("Delete")} />`. */
export const tip = (text) => ({ tooltip: text, tooltipOptions: TIP, "aria-label": text });
