"use client";

import { useEffect, useState } from "react";
import { Button } from "primereact/button";
import { SelectButton } from "primereact/selectbutton";
import { seatDirection, stationEnds } from "@/lib/layout";
import "./plan.css";

import { TIP } from "@/components/ui/tip";
const ORIENTATION_KEY = "sp_seatgrid_orientation";

const ORIENTATIONS = [
  { label: "Vertical", value: "vertical", icon: "pi pi-arrows-v" },
  { label: "Horizontal", value: "horizontal", icon: "pi pi-arrows-h" },
];

function SeatBox({ seat, dir, horizontal, readOnly, selected, onClick }) {
  const cls = ["seat"];
  if (readOnly) cls.push("readonly");
  if (selected) cls.push("selected");
  if (seat.isWindow) cls.push("window");

  // The direction marker follows the coach: down the page when the plan runs
  // vertically, along it when it runs horizontally.
  const arrow = horizontal ? (dir === "down" ? "▶" : "◀") : dir === "down" ? "▼" : "▲";

  return (
    <div className={cls.join(" ")} onClick={readOnly ? undefined : onClick} title={seat.note || undefined}>
      <div className="seat-badges">
        {seat.isWindow && (
          <span className="seat-badge" title={`${seat.windowType} window`}>
            {seat.windowType === "half" ? "½W" : "W"}
          </span>
        )}
        {seat.chargingPort && <span className="seat-amenity" title="Charging port">🔌</span>}
        {seat.fan && <span className="seat-amenity" title="Fan">🌀</span>}
      </div>
      <span className="seat-number">{seat.number || "·"}</span>
      <span className="seat-dir">{arrow}</span>
    </div>
  );
}

/**
 * Renders a seat-plan layout. In editable mode it exposes seat selection,
 * blank/seat toggling, and per-row structural controls via callbacks.
 *
 * Orientation is a pure CSS transpose — the same markup, with rows laid out as
 * columns — rather than a rotation, so every number and label stays upright and
 * readable. A 105-seat coach is 22 rows tall, which no laptop shows at once;
 * turned on its side it fits the shape of the screen.
 */
export default function SeatGrid({
  layout,
  readOnly = false,
  selected = null,
  defaultOrientation = "vertical",
  onSeatClick,
  onCellToggle,
  onAddCell,
  onAddRow,
  onDeleteRow,
  onMoveRow,
  onMoveDivider,
}) {
  const [orientation, setOrientation] = useState(defaultOrientation);

  // Remember the reader's choice — it is a viewing preference, not plan data.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ORIENTATION_KEY);
      if (saved === "vertical" || saved === "horizontal") setOrientation(saved);
    } catch {
      /* private mode or blocked storage — the default is fine */
    }
  }, []);

  const changeOrientation = (value) => {
    if (!value) return;
    setOrientation(value);
    try {
      localStorage.setItem(ORIENTATION_KEY, value);
    } catch {
      /* not worth failing a render over */
    }
  };

  const horizontal = orientation === "horizontal";
  const ends = stationEnds(layout);
  const rowCount = layout.rows.length;

  const renderDivider = (key) => (
    <div className="seatgrid-divider" key={key}>
      {!readOnly && onMoveDivider && (
        <Button aria-label={horizontal ? "Move divider left" : "Move divider up"} tooltipOptions={TIP}
          icon={horizontal ? "pi pi-angle-left" : "pi pi-angle-up"}
          rounded
          text
          size="small"
          onClick={() => onMoveDivider(-1)}
          tooltip={horizontal ? "Move divider left" : "Move divider up"}
        />
      )}
      <span className="line" />
      <span className="label">{horizontal ? "↔" : "↕"} direction split</span>
      <span className="line" />
      {!readOnly && onMoveDivider && (
        <Button aria-label={horizontal ? "Move divider right" : "Move divider down"} tooltipOptions={TIP}
          icon={horizontal ? "pi pi-angle-right" : "pi pi-angle-down"}
          rounded
          text
          size="small"
          onClick={() => onMoveDivider(1)}
          tooltip={horizontal ? "Move divider right" : "Move divider down"}
        />
      )}
    </div>
  );

  const orientationTemplate = (option) => (
    <span className="seatgrid-orientation-option">
      <i className={option.icon} /> {option.label}
    </span>
  );

  return (
    <div className="seatgrid-wrap">
      <div className="seatgrid-toolbar">
        <SelectButton
          value={orientation}
          options={ORIENTATIONS}
          optionLabel="label"
          optionValue="value"
          itemTemplate={orientationTemplate}
          onChange={(e) => changeOrientation(e.value)}
          allowEmpty={false}
          aria-label="Seat plan orientation"
        />
        <span className="seatgrid-hint">
          {rowCount} rows · {horizontal ? "reading left to right" : "reading top to bottom"}
        </span>
      </div>

      {/* Wide plans scroll inside this box, never the whole page. */}
      <div className="seatgrid-scroll">
        <div className={`seatgrid ${horizontal ? "seatgrid--horizontal" : ""}`}>
          <div className="seatgrid-station">
            <i className={horizontal ? "pi pi-arrow-left" : "pi pi-arrow-up"} />
            <span>{ends.top}</span>
          </div>

          {layout.direction.splitRow === 0 && renderDivider("div-top")}

          {layout.rows.map((row, rowIdx) => {
            const dir = seatDirection(layout, rowIdx);
            return (
              <div className="seatgrid-rowwrap" key={row.id}>
                <div className="seatgrid-row">
                  {!readOnly && (
                    <div className="row-gutter">
                      <span className="row-index">{rowIdx + 1}</span>
                      <Button aria-label="Add row above" tooltipOptions={TIP} icon="pi pi-plus" rounded text size="small" onClick={() => onAddRow(rowIdx, "above")} tooltip="Add row above" />
                    </div>
                  )}

                  <div className="seatgrid-cells">
                    {row.cells.map((cell, cellIdx) =>
                      cell.kind === "seat" ? (
                        <div className="seat-slot" key={cell.id}>
                          <SeatBox
                            seat={cell}
                            dir={dir}
                            horizontal={horizontal}
                            readOnly={readOnly}
                            selected={selected && selected.rowIdx === rowIdx && selected.cellIdx === cellIdx}
                            onClick={() => onSeatClick(rowIdx, cellIdx)}
                          />
                        </div>
                      ) : (
                        <div className={`seat-slot blank ${readOnly ? "readonly" : ""}`} key={`b-${cellIdx}`}>
                          <div className="blank-box" onClick={readOnly ? undefined : () => onCellToggle(rowIdx, cellIdx)} title={readOnly ? undefined : "Click to make a seat"}>
                            {readOnly ? "" : "+"}
                          </div>
                        </div>
                      )
                    )}
                    {!readOnly && onAddCell && row.cells.length < layout.columns && (
                      <div className="seat-slot add-cell" key="add">
                        <button type="button" className="add-cell-box" onClick={() => onAddCell(rowIdx)} title="Add a cell to this row">
                          <i className="pi pi-plus" />
                        </button>
                      </div>
                    )}
                  </div>

                  {!readOnly && (
                    <div className="row-gutter">
                      <Button aria-label={horizontal ? "Move left" : "Move up"} tooltipOptions={TIP}
                        icon={horizontal ? "pi pi-angle-left" : "pi pi-angle-up"}
                        rounded text size="small"
                        disabled={rowIdx === 0}
                        onClick={() => onMoveRow(rowIdx, -1)}
                        tooltip={horizontal ? "Move left" : "Move up"}
                      />
                      <Button aria-label={horizontal ? "Move right" : "Move down"} tooltipOptions={TIP}
                        icon={horizontal ? "pi pi-angle-right" : "pi pi-angle-down"}
                        rounded text size="small"
                        disabled={rowIdx === rowCount - 1}
                        onClick={() => onMoveRow(rowIdx, 1)}
                        tooltip={horizontal ? "Move right" : "Move down"}
                      />
                      <Button aria-label="Delete row" tooltipOptions={TIP} icon="pi pi-trash" rounded text severity="danger" size="small" onClick={() => onDeleteRow(rowIdx)} tooltip="Delete row" />
                      <Button aria-label="Add row below" tooltipOptions={TIP} icon="pi pi-plus" rounded text size="small" onClick={() => onAddRow(rowIdx, "below")} tooltip="Add row below" />
                    </div>
                  )}
                </div>

                {layout.direction.splitRow === rowIdx + 1 && renderDivider(`div-${rowIdx}`)}
              </div>
            );
          })}

          <div className="seatgrid-station">
            <span>{ends.bottom}</span>
            <i className={horizontal ? "pi pi-arrow-right" : "pi pi-arrow-down"} />
          </div>
        </div>
      </div>
    </div>
  );
}
