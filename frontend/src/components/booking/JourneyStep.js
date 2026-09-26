"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Select from "@/components/ui/Select";
import { Button } from "primereact/button";
import { InputNumber } from "primereact/inputnumber";
import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";
import { fetchSearchStations, fetchBookableDates, searchDepartures } from "@/lib/booking";
import AvailabilityMatrix from "./AvailabilityMatrix";
import JoinWaitlistDialog from "./JoinWaitlistDialog";

import { TIP } from "@/components/ui/tip";
/**
 * Where, when, and how many.
 *
 * The search runs on demand rather than as the fields change: each one costs an
 * availability pass over every departure that day, and a passenger picking a
 * station from a long list would otherwise fire several before landing on the
 * one they meant.
 */
export default function JourneyStep({ journey, onChange, onPick, onError }) {
  const [stations, setStations] = useState([]);
  const [roomOn, setRoomOn] = useState(null);
  const [dates, setDates] = useState([]);
  const [results, setResults] = useState(null);
  // The departure a passenger is asking to queue for, if any.
  const [queueFor, setQueueFor] = useState(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchSearchStations(), fetchBookableDates(14)])
      .then(([s, d]) => {
        setStations(s);
        setDates(d);
        if (!journey.date && d.length) onChange({ date: d[0] });
      })
      .catch((err) => onError?.(err.message))
      .finally(() => setLoading(false));
    // Once, on mount: the station list does not change while someone shops.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(
    () =>
      stations.map((s) => ({
        label: `${s.name} (${s.code})`,
        value: s.id,
        name: s.name,
        code: s.code,
        district: s.district,
      })),
    [stations]
  );

  const ready = journey.fromStationId && journey.toStationId && journey.date;
  const sameStation =
    journey.fromStationId && journey.fromStationId === journey.toStationId;

  /*
   * Where the answer lands.
   *
   * On a phone the search form fills the screen, so the results render below
   * the fold and the page looks as if nothing happened — people press Search
   * again. Moving to the answer is the expected response to asking a question.
   *
   * Only after a search the person started: `pendingScroll` is set by pressing
   * Search, so results changing for any other reason (the matrix switching
   * stations, a reset) do not yank the page around.
   */
  const answer = useRef(null);
  const pendingScroll = useRef(false);

  useEffect(() => {
    if (!pendingScroll.current || results === null) return;
    pendingScroll.current = false;

    const el = answer.current;
    if (!el) return;

    // Only if the answer is not already on screen — on a laptop it usually is,
    // and scrolling to something already visible is a jolt for nothing.
    const box = el.getBoundingClientRect();
    const visible = box.top >= 0 && box.top < window.innerHeight * 0.75;
    if (visible) return;

    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }, [results]);

  const search = async () => {
    pendingScroll.current = true;
    setSearching(true);
    setResults(null);
    try {
      const data = await searchDepartures({
        fromStationId: journey.fromStationId,
        toStationId: journey.toStationId,
        date: journey.date,
      });
      setResults(data.departures);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSearching(false);
    }
  };

  const swap = () =>
    onChange({ fromStationId: journey.toStationId, toStationId: journey.fromStationId });

  return (
    <div className="book-step">
      {loading ? (
        <div className="book-centre">
          <ProgressSpinner style={{ width: 36, height: 36 }} />
        </div>
      ) : (
        <>
          <div className="journey-form card">
            <div className="journey-route">
              <div className="journey-field">
                <label htmlFor="from">From</label>
                <Select
                  inputId="from"
                  value={journey.fromStationId}
                  options={options}
                  onChange={(e) => onChange({ fromStationId: e.value })}
                  placeholder="Where are you starting?"
                  filter
                  filterBy="label,district"
                  filterPlaceholder="Station, code or district"
                  itemTemplate={stationItem}
                  valueTemplate={stationValue}
                  showClear
                  className="journey-station"
                />
              </div>

              <Button
                icon="pi pi-arrow-right-arrow-left"
                rounded
                outlined
                onClick={swap}
                className="journey-swap"
                aria-label="Swap origin and destination"
                tooltip="Swap origin and destination"
                tooltipOptions={TIP}
                disabled={!journey.fromStationId && !journey.toStationId}
              />

              <div className="journey-field">
                <label htmlFor="to">To</label>
                <Select
                  inputId="to"
                  value={journey.toStationId}
                  options={options}
                  onChange={(e) => onChange({ toStationId: e.value })}
                  placeholder="Where are you going?"
                  filter
                  filterBy="label,district"
                  filterPlaceholder="Station, code or district"
                  itemTemplate={stationItem}
                  valueTemplate={stationValue}
                  showClear
                  className="journey-station"
                />
              </div>

              <div className="journey-field journey-field--count">
                <label htmlFor="count">Seats</label>
                <InputNumber
                  inputId="count"
                  value={journey.count}
                  onValueChange={(e) => onChange({ count: e.value || 1 })}
                  min={1}
                  max={4}
                  showButtons
                  buttonLayout="horizontal"
                  incrementButtonIcon="pi pi-plus"
                  decrementButtonIcon="pi pi-minus"
                  incrementButtonClassName="journey-count__btn"
                  decrementButtonClassName="journey-count__btn"
                  className="journey-count"
                  inputStyle={{ width: "2.75rem", textAlign: "center" }}
                />
              </div>
            </div>

            <div className="journey-when">
              <div className="journey-field journey-field--dates">
                <span className="journey-label" id="date-label">
                  Date
                </span>
                <DateRail
                  dates={dates}
                  value={journey.date}
                  onChange={(date) => onChange({ date })}
                  labelledBy="date-label"
                />
              </div>

              <Button
                label="Search trains"
                icon="pi pi-search"
                onClick={search}
                loading={searching}
                disabled={!ready || sameStation}
                className="journey-search"
              />
            </div>
          </div>

          {sameStation && (
            <Message
              severity="warn"
              text="Origin and destination are the same station."
              className="book-message"
            />
          )}

          {/* Scroll target for the answer, whichever answer it is. The offset
              keeps it clear of the sticky header. */}
          <div ref={answer} className="journey-answer" aria-hidden="true" />

          {results && results.length === 0 && (
            <Message
              severity="info"
              className="book-message"
              text="No train runs between those stations on that date. Try another date, or a nearby station."
            />
          )}

          {roomOn && (
            <AvailabilityMatrix
              tripId={roomOn.tripId}
              trainName={roomOn.train?.name}
              fromStationId={journey.fromStationId}
              toStationId={journey.toStationId}
              wanted={journey.count}
              visible={Boolean(roomOn)}
              onHide={() => setRoomOn(null)}
              onPick={({ fromStationId, toStationId }) => {
                // Switching the journey re-runs the search rather than jumping
                // straight to seats: the fare and the times both change.
                setRoomOn(null);
                onChange({ fromStationId, toStationId });
                setResults(null);
              }}
            />
          )}

          {results && results.length > 0 && (
            <div className="departure-list">
              <p className="departure-list__head">
                <strong>
                  {results.length} train{results.length === 1 ? "" : "s"}
                </strong>{" "}
                on {longDate(journey.date)}
              </p>
              {results.map((d) => (
                <DepartureCard
                  key={d.tripId}
                  departure={d}
                  wanted={journey.count}
                  onPick={() => onPick(d)}
                  onShowRoom={() => setRoomOn(d)}
                  onQueue={() => setQueueFor(d)}
                />
              ))}
            </div>
          )}

          {/* Offered at the point of refusal, which is the only place it means
              anything: a passenger told "not enough seats" has somewhere to go
              other than away. */}
          <JoinWaitlistDialog
            visible={Boolean(queueFor)}
            onHide={() => setQueueFor(null)}
            departure={queueFor}
            journey={journey}
            onJoined={() => onError?.(null)}
            onError={onError}
          />
        </>
      )}
    </div>
  );
}

function DepartureCard({ departure, wanted, onPick, onShowRoom, onQueue }) {
  const enough = departure.availableCount >= wanted;
  const scarce = enough && departure.availableCount <= 10;
  const took = duration(departure.from, departure.to);

  return (
    <article className={`departure-card${enough ? "" : " is-full"}`}>
      <header className="departure-card__head">
        <h3>
          <i className="pi pi-ticket" aria-hidden="true" />
          {departure.train.name}
        </h3>
        <span className={`departure-seats${scarce ? " is-scarce" : ""}${enough ? "" : " is-short"}`}>
          <i className={`pi ${enough ? "pi-check-circle" : "pi-exclamation-circle"}`} aria-hidden="true" />
          {enough
            ? `${departure.availableCount} seat${departure.availableCount === 1 ? "" : "s"} free`
            : `Only ${departure.availableCount} left — you asked for ${wanted}`}
        </span>
      </header>

      <div className="departure-times">
        <div className="departure-times__end">
          <strong>{shortTime(departure.from.time)}</strong>
          <span>{departure.from.name}</span>
        </div>
        <div className="departure-times__line" aria-hidden="true">
          {took && <small>{took}</small>}
          <span />
          <small>
            {departure.stopsBetween === 0
              ? "Non-stop"
              : `${departure.stopsBetween} stop${departure.stopsBetween === 1 ? "" : "s"}`}
          </small>
        </div>
        <div className="departure-times__end departure-times__end--to">
          <strong>
            {shortTime(departure.to.time)}
            {departure.to.dayOffset > 0 && <sup title="Arrives the next day">+{departure.to.dayOffset}</sup>}
          </strong>
          <span>{departure.to.name}</span>
        </div>
      </div>
      <p className="sr-only">
        {took ? `Journey time ${took}. ` : ""}
        {departure.stopsBetween === 0 ? "Non-stop." : `${departure.stopsBetween} stops between.`}
        {departure.to.dayOffset > 0 ? " Arrives the next day." : ""}
      </p>

      <ul className="departure-classes" aria-label="Classes on this train">
        {departure.fares.map((f) => (
          <li key={f.coachClassId} className={f.availableCount < wanted ? "is-short" : undefined}>
            <span className="departure-classes__name">{f.coachClass}</span>
            <strong>৳ {f.fareFormatted}</strong>
            <small>{f.availableCount} free</small>
          </li>
        ))}
      </ul>

      <footer className="departure-card__foot">
        {/*
          Offered on every card, but it earns its place on a full one: a train
          with no room end to end usually has room on part of the route, and
          this is the only way a passenger would find that out.
        */}
        <Button
          label={enough ? "Where is there room?" : "See where there IS room"}
          icon="pi pi-table"
          text
          size="small"
          onClick={onShowRoom}
          className="departure-room"
        />

        <div className="departure-card__buy">
          <div className="departure-fare">
            <span>from</span>
            <strong>{departure.cheapestFormatted ? `৳ ${departure.cheapestFormatted}` : "—"}</strong>
          </div>
          {enough ? (
            <Button label="Choose seats" icon="pi pi-angle-right" iconPos="right" onClick={onPick} />
          ) : (
            /* A full train is not a dead end. Queueing is the offer that turns
               a refusal into something the passenger can still do. */
            <Button
              label={departure.availableCount === 0 ? "Join the queue" : "Queue instead"}
              icon="pi pi-clock"
              iconPos="right"
              onClick={onQueue}
              severity="warning"
              outlined
            />
          )}
        </div>
      </footer>
    </article>
  );
}

/** "2h 05m" between two timetable times, allowing for the day rolling over. */
function duration(from, to) {
  const minutes = (t) => {
    const [h, m] = String(t || "").split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };
  const a = minutes(from?.time);
  const b = minutes(to?.time);
  if (a === null || b === null) return null;
  const total = (to?.dayOffset || 0) * 1440 + b - ((from?.dayOffset || 0) * 1440 + a);
  if (total <= 0) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/* ---------------- Stations in the dropdown ---------------- */

/** A station in the list: its code, its name, and the district to tell two apart. */
function stationItem(option) {
  return (
    <div className="station-opt">
      <span className="station-opt__code">{option.code}</span>
      <span className="station-opt__text">
        <strong>{option.name}</strong>
        {option.district && <small>{option.district}</small>}
      </span>
    </div>
  );
}

/** The chosen station in the closed field: the name, and its code beside it. */
function stationValue(option, props) {
  if (!option) return <span>{props.placeholder}</span>;
  return (
    <span className="station-val">
      <span className="station-val__name">{option.name}</span>
      <span className="station-val__code">{option.code}</span>
    </span>
  );
}

/* ---------------- Dates ---------------- */

const DHAKA = "Asia/Dhaka";
const dhakaDay = (offset = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: DHAKA }).format(new Date(Date.now() + offset * 86400000));

function longDate(iso) {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00+06:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: DHAKA,
  });
}

/**
 * The days a ticket can be bought for, as a strip of chips.
 *
 * Fourteen dates in a dropdown meant opening it to find out what was on
 * offer; as chips they are all visible, and choosing one is one tap. On a
 * phone the strip scrolls sideways, and the chosen day is kept in view.
 */
function DateRail({ dates, value, onChange, labelledBy }) {
  const rail = useRef(null);
  const today = dhakaDay(0);
  const tomorrow = dhakaDay(1);

  useEffect(() => {
    const box = rail.current;
    const chosen = box?.querySelector('[aria-checked="true"]');
    if (!box || !chosen) return;
    // Scroll the strip only — scrollIntoView would also move the page.
    const left = chosen.offsetLeft - box.offsetLeft;
    if (left < box.scrollLeft || left + chosen.offsetWidth > box.scrollLeft + box.clientWidth) {
      box.scrollTo({ left: Math.max(0, left - 16) });
    }
  }, [value]);

  if (!dates.length) {
    return <p className="date-rail__empty">No dates are on sale yet.</p>;
  }

  return (
    <div className="date-rail" role="radiogroup" aria-labelledby={labelledBy} ref={rail}>
      {dates.map((d) => {
        const at = new Date(`${d}T00:00:00+06:00`);
        const weekday =
          d === today
            ? "Today"
            : d === tomorrow
              ? "Tomorrow"
              : at.toLocaleDateString("en-GB", { weekday: "short", timeZone: DHAKA });
        const day = at.toLocaleDateString("en-GB", { day: "numeric", timeZone: DHAKA });
        const month = at.toLocaleDateString("en-GB", { month: "short", timeZone: DHAKA });
        const on = d === value;
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={longDate(d)}
            title={longDate(d)}
            className={`date-chip${on ? " is-on" : ""}`}
            onClick={() => onChange(d)}
          >
            <small>{weekday}</small>
            <strong>{day}</strong>
            <small>{month}</small>
          </button>
        );
      })}
    </div>
  );
}

const shortTime = (value) => (value ? String(value).slice(0, 5) : "—");
