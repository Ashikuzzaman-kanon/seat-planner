"use client";

import { Button } from "primereact/button";
import { seatDirection, stationEnds } from "@/lib/layout";
import "./plan.css";

function SeatBox({ seat, dir, readOnly, selected, onClick }) {
  const cls = ["seat"];
  if (readOnly) cls.push("readonly");
  if (selected) cls.push("selected");
  if (seat.isWindow) cls.push("window");
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
      <span className="seat-dir">{dir === "down" ? "▼" : "▲"}</span>
    </div>
  );
}

/**
 * Renders a seat-plan layout. In editable mode it exposes seat selection,
 * blank/seat toggling, and per-row structural controls via callbacks.
 */
export default function SeatGrid({
  layout,
  readOnly = false,
  selected = null,
  onSeatClick,
  onCellToggle,
  onAddCell,
  onAddRow,
  onDeleteRow,
  onMoveRow,
  onMoveDivider,
}) {
  const ends = stationEnds(layout);
  const rowCount = layout.rows.length;

  const renderDivider = (key) => (
    <div className="seatgrid-divider" key={key}>
      {!readOnly && onMoveDivider && (
        <Button icon="pi pi-angle-up" rounded text size="small" onClick={() => onMoveDivider(-1)} tooltip="Move divider up" />
      )}
      <span className="line" />
      <span className="label">↕ direction split</span>
      <span className="line" />
      {!readOnly && onMoveDivider && (
        <Button icon="pi pi-angle-down" rounded text size="small" onClick={() => onMoveDivider(1)} tooltip="Move divider down" />
      )}
    </div>
  );

  return (
    <div className="seatgrid">
      <div className="seatgrid-station">
        <i className="pi pi-arrow-up" />{ends.top}
      </div>

      {layout.direction.splitRow === 0 && renderDivider("div-top")}

      {layout.rows.map((row, rowIdx) => {
        const dir = seatDirection(layout, rowIdx);
        return (
          <div key={row.id}>
            <div className="seatgrid-row">
              {!readOnly && (
                <div className="row-gutter">
                  <span className="row-index">{rowIdx + 1}</span>
                  <Button icon="pi pi-plus" rounded text size="small" onClick={() => onAddRow(rowIdx, "above")} tooltip="Add row above" />
                </div>
              )}

              <div className="seatgrid-cells">
                {row.cells.map((cell, cellIdx) =>
                  cell.kind === "seat" ? (
                    <div className="seat-slot" key={cell.id}>
                      <SeatBox
                        seat={cell}
                        dir={dir}
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
                  <Button icon="pi pi-angle-up" rounded text size="small" disabled={rowIdx === 0} onClick={() => onMoveRow(rowIdx, -1)} tooltip="Move up" />
                  <Button icon="pi pi-angle-down" rounded text size="small" disabled={rowIdx === rowCount - 1} onClick={() => onMoveRow(rowIdx, 1)} tooltip="Move down" />
                  <Button icon="pi pi-trash" rounded text severity="danger" size="small" onClick={() => onDeleteRow(rowIdx)} tooltip="Delete row" />
                  <Button icon="pi pi-plus" rounded text size="small" onClick={() => onAddRow(rowIdx, "below")} tooltip="Add row below" />
                </div>
              )}
            </div>

            {layout.direction.splitRow === rowIdx + 1 && renderDivider(`div-${rowIdx}`)}
          </div>
        );
      })}

      <div className="seatgrid-station">
        {ends.bottom}<i className="pi pi-arrow-down" />
      </div>
    </div>
  );
}
