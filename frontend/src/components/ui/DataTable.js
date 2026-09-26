"use client";

import { forwardRef } from "react";
import { DataTable as PrimeDataTable } from "primereact/datatable";
import "./table.css";

/**
 * The one data table.
 *
 * ## Why a wrapper
 *
 * Sixteen tables across the app, and on a phone every one of them did the same
 * thing: kept its desktop width and scrolled sideways, so the column a person
 * came for — an email, an action button — sat off the right edge where nobody
 * thinks to swipe. On a narrow screen a row is better read as a card: each
 * value under its own column name, stacked, nothing hidden.
 *
 * PrimeReact half-does that itself: `responsiveLayout="stack"` labels every
 * cell with its column title, but (in 10.x) never injects the layout rules on
 * first render. So the prop is set here, where no table can forget it, and the
 * layout and the card look live in one stylesheet (`table.css`).
 *
 * ## What it changes
 *
 * - **Below 640px, rows become cards.** Each cell is labelled with its column
 *   header. Columns without a header (action buttons) sit at the card's foot.
 * - **Rows highlight on hover**, so a wide row can be followed across.
 * - Everything else passes straight through: this is a drop-in for the
 *   PrimeReact component, and a screen that needs the old behaviour can pass
 *   `responsiveLayout="scroll"`.
 */
const DataTable = forwardRef(function DataTable(
  { className = "", responsiveLayout = "stack", breakpoint = "640px", rowHover = true, ...rest },
  ref
) {
  return (
    <PrimeDataTable
      ref={ref}
      responsiveLayout={responsiveLayout}
      breakpoint={breakpoint}
      rowHover={rowHover}
      className={`ui-table${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
});

export { DataTable };
export default DataTable;
