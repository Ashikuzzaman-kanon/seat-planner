"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { SelectButton } from "primereact/selectbutton";
import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";
import { fetchDepartureMatrix } from "@/lib/booking";
import PairMatrix, { PairMatrixLegend, heatStyle } from "@/components/ui/PairMatrix";

/**
 * Where there is room on this train.
 *
 * A seat is sold per segment, so "the train is full" is almost never true of
 * the whole train — it is true of one stretch. A passenger told only that their
 * journey is unavailable has no way to discover that the train has plenty of
 * room as far as Santahar, or that travelling one stop further back would work.
 *
 * The operator's version of this is a station-by-station grid, which is the
 * right shape for someone auditing a departure and the wrong shape for someone
 * standing on a platform. So the default here is the single row that answers
 * the question actually being asked — from where I am, how far can I get? — and
 * the full grid is a click away for anyone who wants it.
 */

const VIEWS = [
  { label: "From my station", value: "row" },
  { label: "Every pair", value: "grid" },
];

export default function AvailabilityMatrix({
  tripId,
  trainName,
  fromStationId,
  toStationId,
  wanted = 1,
  visible,
  onHide,
  onPick,
}) {
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState("row");

  useEffect(() => {
    if (!visible || !tripId) return;

    setLoading(true);
    setError(null);
    setMatrix(null);

    fetchDepartureMatrix(tripId)
      .then(setMatrix)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [visible, tripId]);

  const byPair = useMemo(() => {
    const map = new Map();
    (matrix?.pairs || []).forEach((p) => map.set(`${p.fromStationId}-${p.toStationId}`, p));
    return map;
  }, [matrix]);

  // The row that answers the question: everywhere reachable from where they are.
  const onward = useMemo(() => {
    if (!matrix) return [];
    return matrix.pairs
      .filter((p) => p.fromStationId === Number(fromStationId))
      .sort((a, b) => a.toSequence - b.toSequence);
  }, [matrix, fromStationId]);

  // And the other way round: boarding further along, to where they want to go.
  const inbound = useMemo(() => {
    if (!matrix) return [];
    return matrix.pairs
      .filter((p) => p.toStationId === Number(toStationId))
      .sort((a, b) => a.fromSequence - b.fromSequence);
  }, [matrix, toStationId]);

  const chosen = byPair.get(`${fromStationId}-${toStationId}`);
  const chosenIsShort = chosen && chosen.available < wanted;

  return (
    <Dialog
      header={trainName ? `Where there is room — ${trainName}` : "Where there is room"}
      visible={visible}
      onHide={onHide}
      className="matrix-dialog"
      dismissableMask
      draggable={false}
      maximizable
    >
      {loading && (
        <div className="book-centre">
          <ProgressSpinner style={{ width: 36, height: 36 }} />
        </div>
      )}

      {error && <Message severity="error" text={error} className="book-message" />}

      {matrix && (
        <>
          <p className="matrix-intro">
            A seat is sold for the stretch you travel, so this train can be full end to end and
            still have room on part of the route.
          </p>

          {chosen && (
            <div className={`matrix-chosen${chosenIsShort ? " is-short" : ""}`}>
              <div>
                <span className="matrix-chosen__label">Your journey</span>
                <strong>
                  {chosen.fromStation} → {chosen.toStation}
                </strong>
              </div>
              <span className="matrix-chosen__count">
                {chosen.available === 0
                  ? "no seats"
                  : `${chosen.available} seat${chosen.available === 1 ? "" : "s"}`}
              </span>
            </div>
          )}

          <SelectButton
            value={view}
            options={VIEWS}
            onChange={(e) => e.value && setView(e.value)}
            allowEmpty={false}
            className="matrix-views"
          />

          {view === "row" ? (
            <>
              <RowView
                title={`Travelling on from ${onward[0]?.fromStation || "your station"}`}
                hint="How far you can get, starting where you planned to."
                pairs={onward}
                nameOf={(p) => p.toStation}
                highlightId={Number(toStationId)}
                idOf={(p) => p.toStationId}
                wanted={wanted}
                onPick={(p) => onPick?.({ fromStationId: p.fromStationId, toStationId: p.toStationId })}
              />

              {inbound.length > 1 && (
                <RowView
                  title={`Joining earlier, bound for ${inbound[0]?.toStation || "your destination"}`}
                  hint="Boarding at a different station, arriving where you meant to."
                  pairs={inbound}
                  nameOf={(p) => p.fromStation}
                  highlightId={Number(fromStationId)}
                  idOf={(p) => p.fromStationId}
                  wanted={wanted}
                  onPick={(p) => onPick?.({ fromStationId: p.fromStationId, toStationId: p.toStationId })}
                />
              )}
            </>
          ) : (
            <PairMatrix
              stops={matrix.stops}
              pairs={matrix.pairs}
              chosen={{ fromStationId, toStationId }}
              canPick={(pair) => pair.available >= wanted}
              whyNot={(pair) => `only ${pair.available} free, and you need ${wanted}`}
              onPick={(pair) =>
                onPick?.({ fromStationId: pair.fromStationId, toStationId: pair.toStationId })
              }
              caption="Seats free between each pair of stations on this train"
            />
          )}

          <PairMatrixLegend total={matrix.totalSeats} chosenLabel={chosen ? "Your journey" : null} />
        </>
      )}
    </Dialog>
  );
}

/**
 * One direction of travel as a plain list.
 *
 * Reads down the route in order, so the shape of the train's occupancy is
 * visible at a glance — where it fills up, and where it frees again.
 */
function RowView({ title, hint, pairs, nameOf, idOf, highlightId, wanted, onPick }) {
  if (!pairs.length) return null;

  return (
    <section className="matrix-row">
      <h4>{title}</h4>
      <p className="matrix-row__hint">{hint}</p>

      <ul className="matrix-list">
        {pairs.map((pair) => {
          const enough = pair.available >= wanted;
          const isChosen = idOf(pair) === highlightId;

          return (
            <li key={`${pair.fromStationId}-${pair.toStationId}`}>
              <button
                type="button"
                className={`matrix-item${pair.available === 0 ? " is-none" : ""}${
                  isChosen ? " is-chosen" : ""
                }${enough ? "" : " is-short"}`}
                style={heatStyle(pair.available, pair.total)}
                onClick={() => enough && onPick?.(pair)}
                disabled={!enough}
                title={
                  enough
                    ? `Search ${pair.fromStation} to ${pair.toStation}`
                    : `Only ${pair.available} free, and ${wanted} are needed`
                }
              >
                <span className="matrix-item__name">
                  {nameOf(pair)}
                  {isChosen && <span className="matrix-item__tag">your stop</span>}
                </span>
                <span className="matrix-item__bar" aria-hidden="true" />
                <span className="matrix-item__count">
                  {pair.available}
                  <small> free</small>
                </span>
                {enough && <i className="pi pi-angle-right matrix-item__go" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
