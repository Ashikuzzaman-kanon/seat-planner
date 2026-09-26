"use client";

import { useEffect } from "react";

/**
 * Hover text for the icon-only controls PrimeReact draws itself.
 *
 * Our own icon buttons carry a tooltip (see tip.js). These are the library's:
 * a dialog's ×, the pager arrows, the steppers on a number field, a select's
 * clear ×, the password eye, a table's row expander. None of them has a
 * title, and the library's pass-through options would have to be set on
 * every component. So this watches the page and gives each one a title when
 * it appears — a dialog opening later is covered the same way.
 *
 * A fixed title is only ever *added*: anything that already has one is left
 * alone. A `live` title follows the control's state (expanded or not, the
 * password shown or hidden) and is kept up to date.
 */
const RULES = [
  { selector: ".p-dialog-header-close", text: () => "Close" },
  {
    selector: ".p-dialog-header-maximize",
    live: true,
    text: (el) => (el.closest(".p-dialog-maximized") ? "Restore size" : "Full screen"),
  },
  { selector: ".p-paginator-first", text: () => "First page" },
  { selector: ".p-paginator-prev", text: () => "Previous page" },
  { selector: ".p-paginator-next", text: () => "Next page" },
  { selector: ".p-paginator-last", text: () => "Last page" },
  { selector: ".p-inputnumber-button-up", text: () => "Increase" },
  { selector: ".p-inputnumber-button-down", text: () => "Decrease" },
  { selector: ".p-dropdown-clear-icon", text: () => "Clear" },
  { selector: ".p-dropdown-trigger, .p-multiselect-trigger", text: () => "Show options" },
  {
    selector: ".p-password .p-icon-field > svg, .p-password .p-icon-field > i",
    live: true,
    text: (el) =>
      el.closest(".p-password")?.querySelector("input[type=password]") ? "Show password" : "Hide password",
  },
  {
    selector: ".p-row-toggler",
    live: true,
    text: (el) => (el.getAttribute("aria-expanded") === "true" ? "Hide details" : "Show details"),
  },
  { selector: ".p-toast-icon-close, .p-message-close, .p-inline-message-close", text: () => "Dismiss" },
];

function label(root) {
  for (const rule of RULES) {
    for (const el of root.querySelectorAll(rule.selector)) {
      if (!rule.live && el.hasAttribute("title")) continue;
      const next = rule.text(el);
      if (el.getAttribute("title") !== next) el.setAttribute("title", next);
    }
  }
}

export default function HoverTitles() {
  useEffect(() => {
    let queued = false;
    const run = () => {
      queued = false;
      label(document.body);
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(run);
    };

    run();
    // `title` is not watched, so setting one never re-triggers this.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "type", "class"],
    });
    return () => observer.disconnect();
  }, []);

  return null;
}
