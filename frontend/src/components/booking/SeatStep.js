"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "primereact/button";
import Select from "@/components/ui/Select";
import { Checkbox } from "primereact/checkbox";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import { SelectButton } from "primereact/selectbutton";
import CoachMap, { CoachLegend, OrientationToggle } from "./CoachMap";
import {
  fetchSellableSeats,
  previewSeats,
  autoHold,
  createHold,
  TOGETHERNESS_LABELS,
} from "@/lib/booking";

/**
 * Choosing seats, by hand or by asking.
 *
 * Both paths end in a hold, because a seat is only really yours once the
 * inventory says so. The auto path holds server-side in one step — choosing and
 * then holding as two round trips would leave a window for someone else to take
 * what was just proposed.
 *
 * The preferences are shown as what they are: preferences. "Only these" turns
 * them into requirements, and then an unmeetable one is refused with the reason
 * rather than quietly ignored.
 */

const MODES = [
  { label: "Pick for me", value: "auto" },
  { label: "Choose myself", value: "manual" },
];

/** The attribute keys the seat catalogue actually uses. */
const PREFERENCES = [
  { key: "window", label: "Window seat", icon: "pi pi-th-large" },
  { key: "charging_port", label: "Charging port", icon: "pi pi-bolt" },
  { key: "fan", label: "Fan", icon: "pi pi-sun" },
];

export default function SeatStep({ journey, departure, onHeld, onBack, onError }) {
  const [mode, setMode] = useState("auto");
  const [criteria, setCriteria] = useState({});
  const [together, setTogether] = useState(journey.count > 1);
  const [strict, setStrict] = useState(false);
  const [coachClassId, setCoachClassId] = useState(null);

  const [preview, setPreview] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [working, setWorking] = useState(false);

  const [seats, setSeats] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [loadingSeats, setLoadingSeats] = useState(false);

  /*
   * Which coach is open, and which way the plan is drawn.
   *
   * One coach at a time: five carriages and four hundred seats drawn at once is
   * a page nobody can navigate. The direction is a preference rather than a
   * decision to make for someone — down the page suits a phone, across matches
   * how a train is drawn on a platform board.
   */
  const [openCoachId, setOpenCoachId] = useState(null);
  const [orientation, setOrientation] = useState("vertical");

  const base = useMemo(
    () => ({
      tripId: departure.tripId,
      fromStationId: journey.fromStationId,
      toStationId: journey.toStationId,
      count: journey.count,
      coachClassId: coachClassId || undefined,
      criteria: Object.keys(criteria).length ? criteria : undefined,
      together,
      strict,
    }),
    [departure.tripId, journey, coachClassId, criteria, together, strict]
  );

  /* ---------------- Auto ---------------- */

  const runPreview = useCallback(async () => {
    setWorking(true);
    setRefusal(null);
    setPreview(null);
    try {
      setPreview(await previewSeats(base));
    } catch (err) {
      setRefusal({ message: err.message, details: err.details });
    } finally {
      setWorking(false);
    }
  }, [base]);

  // Re-ask whenever the preferences change: the passenger is adjusting them
  // precisely to see what they get, so making them press a button as well
  // would be friction with no purpose.
  useEffect(() => {
    if (mode === "auto") runPreview();
  }, [mode, runPreview]);

  const holdAutomatically = async () => {
    setWorking(true);
    try {
      const result = await autoHold(base);
      onHeld({ hold: result.hold, seats: result.seats, note: result.message });
    } catch (err) {
      setRefusal({ message: err.message, details: err.details });
      setWorking(false);
    }
  };

  /* ---------------- Manual ---------------- */

  const loadSeats = useCallback(async () => {
    setLoadingSeats(true);
    try {
      const data = await fetchSellableSeats({
        tripId: departure.tripId,
        fromStationId: journey.fromStationId,
        toStationId: journey.toStationId,
        coachClassId: coachClassId || undefined,
      });
      setSeats(data);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setLoadingSeats(false);
    }
  }, [departure.tripId, journey, coachClassId, onError]);

  useEffect(() => {
    if (mode === "manual") loadSeats();
  }, [mode, loadSeats]);

  /*
   * Open the first coach that has something to offer.
   *
   * Opening nothing leaves a passenger looking at five closed bars and no seats;
   * opening a full one wastes the click. Only set when nothing is open yet, so a
   * reload of the seat list does not close the coach someone is looking at.
   */
  useEffect(() => {
    if (!seats?.coaches?.length) return;
    setOpenCoachId((current) => {
      if (current && seats.coaches.some((c) => c.tripCoachId === current)) return current;
      const withRoom = seats.coaches.find((c) =>
        (c.rows || []).some((r) => (r.cells || []).some((cell) => cell.kind === "seat" && cell.available))
      );
      return (withRoom || seats.coaches[0]).tripCoachId;
    });
  }, [seats]);

  /**
   * A cell from the drawn plan carries `tripSeatId`; the chosen list is keyed
   * on `id`, because that is what the hold endpoint takes. Normalising here
   * keeps both the map and the auto-select proposal speaking the same shape.
   */
  const toggleSeat = (cell) => {
    const seat = {
      id: cell.tripSeatId ?? cell.id,
      seatNumber: cell.seatNumber,
      coachCode: cell.coachCode,
      coachClassId: cell.coachClassId,
    };
    if (!seat.id) return;

    setChosen((current) => {
      if (current.some((s) => s.id === seat.id)) return current.filter((s) => s.id !== seat.id);
      if (current.length >= journey.count) return current;
      return [...current, seat];
    });
  };

  const holdChosen = async () => {
    setWorking(true);
    try {
      const hold = await createHold({
        tripId: departure.tripId,
        seatIds: chosen.map((s) => s.id),
        fromStationId: journey.fromStationId,
        toStationId: journey.toStationId,
      });
      onHeld({ hold, seats: chosen, note: null });
    } catch (err) {
      onError?.(err.message);
      // Someone took one of them: reload so the grid tells the truth.
      if (err.status === 409) {
        setChosen([]);
        loadSeats();
      }
      setWorking(false);
    }
  };

  const classOptions = useMemo(
    () => [
      { label: "Any class", value: null },
      ...(departure.fares || []).map((f) => ({
        label: `${f.coachClass} — ৳ ${f.fareFormatted}`,
        value: f.coachClassId,
      })),
    ],
    [departure.fares]
  );

  /*
   * What each class is called, and what it costs.
   *
   * A seat carries only a `coachClassId`, which means nothing to a passenger
   * choosing between two of them — and the fare differs by class, so choosing
   * blind is choosing a price blind. The departure card already knows every
   * class on this train by name and by fare; this puts that where the seats
   * are.
   */
  const classOf = useMemo(() => {
    const map = new Map();
    for (const fare of departure.fares || []) {
      map.set(fare.coachClassId, { name: fare.coachClass, fare: fare.fareFormatted });
    }
    return map;
  }, [departure.fares]);

  const describeClass = (coachClassId) => classOf.get(coachClassId) || null;

  /*
   * The coaches as drawn, in the order they are coupled.
   *
   * Comes straight from the approved seat plan rather than being reconstructed
   * from the free seats, so aisles, blanks and the direction split are the ones
   * the planner drew.
   */
  const coaches = useMemo(() => {
    const drawn = seats?.coaches || [];
    // A coach with nothing free is still drawn when no class filter is on, so
    // the train looks like a train — but there is no point offering a class
    // filter that yields only full coaches.
    return [...drawn].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }, [seats]);

  return (
    <div className="book-step">
      <div className="seat-toolbar card">
        <SelectButton
          value={mode}
          options={MODES}
          onChange={(e) => e.value && setMode(e.value)}
          allowEmpty={false}
        />

        <Select
          value={coachClassId}
          options={classOptions}
          onChange={(e) => setCoachClassId(e.value)}
          className="seat-class"
        />

        <span className="seat-count-note">
          <i className="pi pi-users" aria-hidden="true" />
          {journey.count} seat{journey.count === 1 ? "" : "s"} to choose
        </span>
      </div>

      {mode === "auto" ? (
        <div className="card seat-auto">
          <h3>What matters to you?</h3>
          <p className="seat-auto__hint">
            We pick the best seats that match. Tick nothing and we simply find you good ones.
          </p>

          <div className="seat-prefs">
            {PREFERENCES.map((p) => (
              <label key={p.key} className="seat-pref">
                <Checkbox
                  inputId={p.key}
                  checked={Boolean(criteria[p.key])}
                  onChange={(e) =>
                    setCriteria((c) => {
                      const next = { ...c };
                      if (e.checked) next[p.key] = true;
                      else delete next[p.key];
                      return next;
                    })
                  }
                />
                <i className={p.icon} aria-hidden="true" />
                <span>{p.label}</span>
              </label>
            ))}
          </div>

          <div className="seat-toggles">
            {journey.count > 1 && (
              <label className="seat-pref">
                <Checkbox
                  inputId="together"
                  checked={together}
                  onChange={(e) => setTogether(e.checked)}
                />
                <span>Seat us together</span>
              </label>
            )}

            <label className="seat-pref">
              <Checkbox
                inputId="strict"
                checked={strict}
                onChange={(e) => setStrict(e.checked)}
              />
              <span>Only these — do not offer me anything else</span>
            </label>
          </div>

          {working && (
            <div className="book-centre">
              <ProgressSpinner style={{ width: 32, height: 32 }} />
            </div>
          )}

          {!working && refusal && (
            <div className="seat-refusal">
              <Message severity="warn" text={refusal.message} />
              {refusal.details?.breakdown && (
                <ul className="seat-breakdown">
                  {Object.entries(refusal.details.breakdown).map(([key, count]) => (
                    <li key={key}>
                      <span>{PREFERENCES.find((p) => p.key === key)?.label || key}</span>
                      <strong>{count} free</strong>
                    </li>
                  ))}
                </ul>
              )}
              {strict && (
                <Button
                  label="Show me what is available anyway"
                  icon="pi pi-undo"
                  text
                  size="small"
                  onClick={() => setStrict(false)}
                />
              )}
            </div>
          )}

          {!working && preview && (
            <div className="seat-proposal">
              <div className="seat-proposal__head">
                <span className="seat-proposal__title">
                  <i className="pi pi-sparkles" aria-hidden="true" />
                  We found you {preview.seats.length === 1 ? "a seat" : `${preview.seats.length} seats`}
                </span>
                <Tag
                  icon="pi pi-check"
                  severity="success"
                  value={TOGETHERNESS_LABELS[preview.togetherness] || preview.togetherLabel}
                />
                {preview.relaxed?.length > 0 && (
                  <Tag
                    severity="warning"
                    value={`Relaxed: ${preview.relaxed.join(", ")}`}
                  />
                )}
              </div>

              <ul className="seat-chips">
                {preview.seats.map((s) => {
                  const klass = describeClass(s.coachClassId);
                  return (
                    <li key={s.id}>
                      <span className="seat-chip__seat">
                        <small>Seat</small>
                        <strong>{s.seatNumber}</strong>
                      </span>
                      <span className="seat-chip__meta">
                        <span>
                          Coach <b>{s.coachCode}</b>
                        </span>
                        {klass && <em className="seat-chip__class">{klass.name}</em>}
                      </span>
                      <span className="seat-chip__marks">
                        {s.attributes?.window && (
                          <i className="pi pi-window-maximize" title="Window" aria-label="Window" />
                        )}
                        {s.attributes?.charging_port && (
                          <i className="pi pi-bolt" title="Charging port" aria-label="Charging port" />
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/* One line naming what is being bought, since every seat on a
                  proposal shares a class and a fare far more often than not. */}
              {(() => {
                const classes = [
                  ...new Set(preview.seats.map((s) => describeClass(s.coachClassId)?.name).filter(Boolean)),
                ];
                if (!classes.length) return null;
                return (
                  <p className="seat-proposal__class">
                    {classes.length === 1 ? classes[0] : classes.join(" and ")}
                    {classes.length === 1 && describeClass(preview.seats[0].coachClassId)?.fare
                      ? ` · ৳ ${describeClass(preview.seats[0].coachClassId).fare} per seat`
                      : ""}
                  </p>
                );
              })()}

              <div className="seat-actions">
                <Button label="Try again" icon="pi pi-refresh" outlined onClick={runPreview} />
                <Button
                  label="Hold these seats"
                  icon="pi pi-lock"
                  onClick={holdAutomatically}
                  loading={working}
                  className="seat-hold"
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card seat-manual">
          {loadingSeats ? (
            <div className="book-centre">
              <ProgressSpinner style={{ width: 32, height: 32 }} />
            </div>
          ) : (
            <>
              <p className="seat-manual__hint">
                {seats?.availableCount ?? 0} seat{seats?.availableCount === 1 ? "" : "s"} free for
                this stretch. Pick {journey.count}.
              </p>

              <div className="seat-map__controls">
                <CoachLegend />
                <OrientationToggle value={orientation} onChange={setOrientation} />
              </div>

              <div className="seat-map">
                {coaches.map((coach) => (
                  <CoachMap
                    key={coach.tripCoachId}
                    coach={coach}
                    chosen={chosen}
                    atLimit={chosen.length >= journey.count}
                    classLabel={describeClass(coach.coachClassId)}
                    orientation={orientation}
                    open={openCoachId === coach.tripCoachId}
                    onToggleOpen={() =>
                      setOpenCoachId((current) =>
                        current === coach.tripCoachId ? null : coach.tripCoachId
                      )
                    }
                    onToggle={(cell) =>
                      toggleSeat({
                        ...cell,
                        coachCode: coach.coachCode,
                        coachClassId: coach.coachClassId,
                      })
                    }
                  />
                ))}
              </div>

              <div className="seat-actions seat-actions--sticky">
                <span className="seat-picked-count">
                  {chosen.length} of {journey.count} chosen
                  {chosen.length > 0 &&
                    `: ${chosen
                      .map((s) => {
                        const klass = describeClass(s.coachClassId);
                        return `${s.seatNumber}${klass ? ` (${klass.name})` : ""}`;
                      })
                      .join(", ")}`}
                </span>
                <Button
                  label="Hold these seats"
                  icon="pi pi-lock"
                  onClick={holdChosen}
                  loading={working}
                  disabled={chosen.length !== journey.count}
                  className="seat-hold"
                />
              </div>
            </>
          )}
        </div>
      )}

      <Button label="Back" icon="pi pi-angle-left" text onClick={onBack} className="book-back" />
    </div>
  );
}
