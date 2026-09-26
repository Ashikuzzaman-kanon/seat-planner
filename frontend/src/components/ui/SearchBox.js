"use client";

import { forwardRef, useMemo, useRef } from "react";
import { InputText } from "primereact/inputtext";
import { IconField } from "primereact/iconfield";
import { InputIcon } from "primereact/inputicon";

/**
 * The one search box.
 *
 * ## Why this replaced what was there
 *
 * Five screens each hand-rolled the same thing: a `<span
 * className="p-input-icon-left">` wrapped around an `InputText`. That class was
 * deprecated in PrimeReact 10 in favour of `IconField`/`InputIcon`, so those
 * boxes were relying on styling the library no longer promises to keep — which
 * is why the icon sat slightly wrong in some of them. This uses the supported
 * API, once.
 *
 * ## What it adds beyond an input with an icon
 *
 * - **A clear button when there is something to clear.** Emptying a search by
 *   holding backspace is a small indignity that every search box should have
 *   stopped asking for years ago. It focuses the field afterwards, so the next
 *   thing typed lands where it is expected.
 * - **A live result count.** A search that filters a list below it should say
 *   how much it filtered — otherwise "no results" and "the list is loading"
 *   look identical, and people re-type a query that was already right.
 * - **Escape clears.** The key everyone already presses.
 *
 * ## Why the clear button is a sibling of IconField, not a child
 *
 * `IconField` runs `React.Children.map(children, cloneElement)` over whatever
 * it is given. A conditionally rendered child is `false` when the condition is
 * false, and `cloneElement(false)` throws — so putting the button inside meant
 * the component crashed whenever the box was *empty*, which is how it starts.
 * The positioning wrapper owns the button instead; `IconField` only ever sees
 * the two children it expects.
 */
const SearchBox = forwardRef(function SearchBox(
  {
    value = "",
    onChange,
    placeholder = "Search",
    /** Optional: how many rows the query left. Renders a count when given. */
    resultCount,
    /** What the rows are called, for that count. */
    noun = "result",
    nounPlural,
    className = "",
    inputClassName = "",
    ariaLabel,
    ...rest
  },
  ref
) {
  const own = useRef(null);
  const input = ref || own;

  const plural = nounPlural || `${noun}s`;
  const has = String(value || "").length > 0;

  const summary = useMemo(() => {
    if (!has || resultCount === undefined || resultCount === null) return null;
    if (resultCount === 0) return `No ${plural} match “${value}”`;
    return `${resultCount} ${resultCount === 1 ? noun : plural}`;
  }, [has, resultCount, value, noun, plural]);

  const clear = () => {
    onChange?.("");
    // Put the cursor back, so typing again does not need another click.
    input.current?.focus?.();
  };

  return (
    <div className={`ui-search${className ? ` ${className}` : ""}`}>
      <div className="ui-search__wrap">
        <IconField iconPosition="left">
          <InputIcon className="pi pi-search" />
          <InputText
            ref={input}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && has) {
                e.preventDefault();
                clear();
              }
            }}
            placeholder={placeholder}
            aria-label={ariaLabel || placeholder}
            className={`ui-search__input${inputClassName ? ` ${inputClassName}` : ""}`}
            {...rest}
          />
        </IconField>

        {has && (
          <button
            type="button"
            className="ui-search__clear"
            onClick={clear}
            aria-label="Clear search"
            title="Clear"
          >
            <i className="pi pi-times" aria-hidden="true" />
          </button>
        )}
      </div>

      {summary && (
        <span className="ui-search__count" aria-live="polite">
          {summary}
        </span>
      )}
    </div>
  );
});

export default SearchBox;
