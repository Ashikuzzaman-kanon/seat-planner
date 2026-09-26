"use client";

/**
 * A coach drawn the way it is actually laid out.
 *
 * ## Why this replaced a list of free seats
 *
 * Choosing a seat by hand is a spatial question — which end of the coach, which
 * side of the aisle, is it a window, who am I next to. The old map answered
 * none of it: it drew only the seats that happened to be free, packed shoulder
 * to shoulder in a plain grid. Four free seats scattered through a coach came
 * out looking like a four-seat coach, and a seat number on its own tells a
 * passenger nothing about where they will be sitting.
 *
 * The railway already has the answer. Somebody drew each coach in the seat
 * planner and somebody else approved it — rows, aisles, blanks, which end is
 * the front. This renders that.
 *
 * ## Taken seats are drawn
 *
 * That is what makes it read as a coach rather than a scatter. They are shown
 * as occupied and nothing more: *why* a seat is unavailable — sold, held by
 * someone mid-checkout, reserved under a quota, blocked for maintenance — is
 * operational detail that belongs on the seat-map screen behind
 * `inventory:view`, not in front of a passenger.
 *
 * ## One coach open at a time
 *
 * A train here runs to five coaches and four hundred seats. All of them drawn
 * at once is a page nobody can navigate, so each coach opens on its header and
 * the rest stay as one-line summaries — the code, the class, the fare, how many
 * are free. That is enough to decide which one to open, which is the only
 * decision being made at that point.
 *
 * ## Which way round
 *
 * The same plan reads two ways. **Down the page** suits a phone: the coach runs
 * top to bottom and rows are wide, so nothing is cut off on a narrow screen.
 * **Across** matches how a train is drawn on a platform display, and on a wide
 * screen shows a whole carriage without scrolling. Neither is right for
 * everybody, so it is a toggle rather than a decision made for them.
 */

function SeatCell({ cell, chosen, atLimit, onToggle }) {
  if (cell.kind !== "seat") {
    // Aisles and gaps are the reason the drawing looks like a coach.
    return <span className="coach-cell coach-cell--blank" aria-hidden="true" />;
  }

  const isChosen = chosen.some((s) => s.id === cell.tripSeatId);
  const taken = !cell.available;
  const blocked = taken || (atLimit && !isChosen);

  const description = [
    `Seat ${cell.seatNumber}`,
    taken ? "taken" : null,
    cell.isWindow ? "window" : null,
    cell.chargingPort ? "charging point" : null,
    cell.fan ? "fan" : null,
    cell.note || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      className={[
        "coach-cell",
        "coach-seat",
        taken ? "is-taken" : "is-free",
        isChosen ? "is-chosen" : "",
        cell.isWindow ? "is-window" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => !blocked && onToggle(cell)}
      disabled={blocked}
      // The state has to survive without colour: a screen reader hears this,
      // and so does anyone who cannot tell the greys apart.
      aria-pressed={isChosen}
      aria-label={description}
      title={description}
    >
      <span className="coach-seat__number">{cell.seatNumber}</span>
      {/* A window seat is drawn with a sky-blue backrest (see the legend), so
          only the charging point needs a mark of its own. */}
      {cell.chargingPort && <i className="pi pi-bolt coach-seat__power" aria-hidden="true" />}
      {isChosen && <i className="pi pi-check coach-seat__tick" aria-hidden="true" />}
    </button>
  );
}

export default function CoachMap({
  coach,
  chosen,
  atLimit,
  onToggle,
  classLabel,
  orientation = "vertical",
  open = false,
  onToggleOpen,
}) {
  const rows = coach.rows || [];
  const split = coach.direction?.splitRow ?? null;

  const free = rows
    .flatMap((r) => r.cells)
    .filter((c) => c.kind === "seat" && c.available).length;

  const mine = rows
    .flatMap((r) => r.cells)
    .filter((c) => c.kind === "seat" && chosen.some((s) => s.id === c.tripSeatId)).length;

  const bodyId = `coach-body-${coach.tripCoachId}`;

  return (
    <section className={`coach${open ? " is-open" : ""}`}>
      {/*
        The whole header is the control. A small chevron as the only hit target
        is a worse target than the bar people already want to press.
      */}
      <button
        type="button"
        className="coach__head"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <span className="coach__head-main">
          <i
            className={`pi ${open ? "pi-chevron-down" : "pi-chevron-right"} coach__chevron`}
            aria-hidden="true"
          />
          <span className="coach__code">{coach.coachCode}</span>
          {classLabel && (
            <span className="coach__class">
              {classLabel.name}
              {classLabel.fare && <em>৳ {classLabel.fare}</em>}
            </span>
          )}
        </span>

        <span className="coach__head-side">
          {/* Shown on a closed coach so a chosen seat is not lost from view. */}
          {mine > 0 && (
            <span className="coach__mine">
              {mine} chosen here
            </span>
          )}
          <span className={`coach__free${free === 0 ? " is-none" : ""}`}>
            {free === 0 ? "No seats free" : `${free} free`}
          </span>
        </span>
      </button>

      {open && (
        <div id={bodyId} className={`coach__body coach__body--${orientation}`}>
          {rows.length === 0 ? (
            /*
             * A coach with no drawn plan. Rare, and it should not cost a
             * passenger the ability to book — so say so rather than showing an
             * empty box.
             */
            <p className="coach__noplan">
              No seat plan is on file for this coach, so it cannot be drawn. Use “Pick for me”,
              or choose another coach.
            </p>
          ) : (
            <div
              className="coach__grid"
              style={{ "--coach-columns": coach.columns || 4 }}
              role="group"
              aria-label={`Coach ${coach.coachCode} seat map`}
            >
              {rows.map((row, rowIndex) => (
                <div key={rowIndex} className="coach__row-wrap">
                  {/* Drawn before the row it precedes, so the line sits between. */}
                  {split === rowIndex && (
                    <div className="coach__split">
                      <span>seats beyond here face the other way</span>
                    </div>
                  )}
                  <div className="coach__row">
                    {row.cells.map((cell, cellIndex) => (
                      <SeatCell
                        key={cell.tripSeatId ?? `${rowIndex}-${cellIndex}`}
                        cell={cell}
                        chosen={chosen}
                        atLimit={atLimit}
                        onToggle={onToggle}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** What the colours mean. Shown once above the coaches, not per coach. */
export function CoachLegend() {
  return (
    <div className="coach-legend">
      <span>
        <i className="coach-legend__swatch is-free" aria-hidden="true" /> Free
      </span>
      <span>
        <i className="coach-legend__swatch is-chosen" aria-hidden="true" /> Yours
      </span>
      <span>
        <i className="coach-legend__swatch is-taken" aria-hidden="true" /> Taken
      </span>
      <span>
        <i className="coach-legend__swatch is-window" aria-hidden="true" /> Window
      </span>
      <span>
        <i className="pi pi-bolt coach-legend__power" aria-hidden="true" /> Charging point
      </span>
    </div>
  );
}

/** Which way the coach is drawn. See the note at the top of this file. */
export function OrientationToggle({ value, onChange }) {
  return (
    <div className="coach-orient" role="group" aria-label="Seat map direction">
      <button
        type="button"
        className={`coach-orient__btn${value === "vertical" ? " is-on" : ""}`}
        onClick={() => onChange("vertical")}
        aria-pressed={value === "vertical"}
      >
        <i className="pi pi-arrow-down" aria-hidden="true" /> Down the page
      </button>
      <button
        type="button"
        className={`coach-orient__btn${value === "horizontal" ? " is-on" : ""}`}
        onClick={() => onChange("horizontal")}
        aria-pressed={value === "horizontal"}
      >
        <i className="pi pi-arrow-right" aria-hidden="true" /> Across
      </button>
    </div>
  );
}
