"use client";

import { forwardRef, useMemo } from "react";
import { Dropdown } from "primereact/dropdown";

/**
 * The one dropdown.
 *
 * ## Why a wrapper rather than using PrimeReact's directly
 *
 * There were thirty Dropdowns across the app and they disagreed with each
 * other. Three had a search box; the rest made you scroll a list of stations by
 * eye. Some could be cleared, most could not. The empty state said "No results
 * found" in one place and nothing at all in another. None of that was decided —
 * it accumulated, one component at a time.
 *
 * So the behaviour is decided once, here, and the defaults are the ones that
 * are right most of the time:
 *
 * - **Search appears when the list is long enough to need it.** A five-item
 *   list with a filter box is clutter; a sixty-station list without one is a
 *   scroll hunt. The threshold picks for you, and either default can be
 *   overridden where a screen knows better.
 * - **Clearable unless it is required.** "None" is a real answer to most
 *   optional questions, and a select you cannot un-choose is a trap.
 * - **The empty state says which of two things happened** — nothing to choose
 *   from, or nothing matched what you typed. Those need different sentences,
 *   because only one of them is fixed by typing less.
 *
 * Everything else passes straight through, so this stays a drop-in for the
 * PrimeReact component and no screen has to learn a new API.
 */

/** Above this many options, a list is faster to search than to scan. */
const FILTER_THRESHOLD = 8;

const isEmpty = (v) => v === null || v === undefined || v === "";

const Select = forwardRef(function Select(
  {
    options = [],
    value,
    onChange,
    filter,
    showClear,
    required = false,
    placeholder,
    filterPlaceholder,
    emptyMessage,
    emptyFilterMessage,
    className = "",
    invalid = false,
    ...rest
  },
  ref
) {
  const count = Array.isArray(options) ? options.length : 0;

  // Explicit wins; otherwise the length of the list decides.
  const searchable = filter ?? count > FILTER_THRESHOLD;

  /*
   * An "All …" option.
   *
   * Filters here start with one — `{ label: "All statuses", value: "" }` —
   * and PrimeReact treats both `null` and `""` as nothing chosen, so it showed
   * the generic placeholder instead of the option's own words, plus a clear
   * button that cleared nothing. When a list has such an option: its label is
   * the placeholder, there is no × while it is in effect, and clearing puts it
   * back rather than leaving a `null` the screen never expected.
   */
  const allOption = Array.isArray(options)
    ? options.find((o) => o && typeof o === "object" && isEmpty(o.value))
    : null;

  const clearable = (showClear ?? !required) && !(allOption && isEmpty(value));

  const change = (e) => {
    if (allOption && e && isEmpty(e.value) && e.value !== allOption.value) {
      const back = allOption.value ?? null;
      onChange?.({ ...e, value: back, target: { ...(e.target || {}), value: back } });
      return;
    }
    onChange?.(e);
  };

  return (
    <Dropdown
      ref={ref}
      options={options}
      value={value}
      onChange={change}
      placeholder={placeholder ?? allOption?.label ?? "Choose one"}
      filter={searchable}
      filterPlaceholder={filterPlaceholder || "Type to narrow the list"}
      showClear={clearable}
      // The two empty states are different problems and say so.
      emptyMessage={emptyMessage || "Nothing to choose from yet"}
      emptyFilterMessage={emptyFilterMessage || "Nothing matches that"}
      className={`ui-select${invalid ? " p-invalid" : ""}${className ? ` ${className}` : ""}`}
      panelClassName="ui-select__panel"
      // A tick against the chosen option: the highlight alone is easy to
      // lose once the list has been arrowed through.
      checkmark
      {...rest}
    />
  );
});

/**
 * A labelled select, for the common case of a form field.
 *
 * Exists so that a label, its hint and its error message are attached the same
 * way every time — `htmlFor` matched to `inputId`, the error announced rather
 * than only coloured red.
 */
export function SelectField({
  id,
  label,
  hint,
  error,
  required = false,
  className = "",
  ...rest
}) {
  const inputId = useMemo(
    () => id || `select-${Math.random().toString(36).slice(2, 9)}`,
    [id]
  );

  return (
    <div className={`ui-field${className ? ` ${className}` : ""}`}>
      {label && (
        <label className="ui-field__label" htmlFor={inputId}>
          {label}
          {required && <span className="ui-field__required" aria-hidden="true">*</span>}
        </label>
      )}

      <Select inputId={inputId} required={required} invalid={Boolean(error)} {...rest} />

      {error ? (
        <small className="ui-field__error" role="alert">
          {error}
        </small>
      ) : (
        hint && <small className="ui-field__hint">{hint}</small>
      )}
    </div>
  );
}

export default Select;
