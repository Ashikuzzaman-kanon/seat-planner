"use client";

import { useEffect, useMemo, useState } from "react";
import { Tag } from "primereact/tag";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import SearchBox from "@/components/ui/SearchBox";
import { ProgressSpinner } from "primereact/progressspinner";
import { Message } from "primereact/message";
import { fetchOccupancy } from "@/lib/inventory";
import "./occupancy.css";

/**
 * Every seat on a departure, sold and free alike.
 *
 * The availability view shows what can be sold. This shows what is going on,
 * which is a different job: an operator staring at a stretch that will not sell
 * needs to know *why*, and for segment-sold seats the answer is almost never
 * "this seat is sold". It is "this seat is sold Setu to Natore" — a stretch
 * that overlaps the one being asked about, and would not overlap a slightly
 * different one.
 *
 * So a taken seat names the journey holding it, and one click opens the booking
 * behind it. Passenger names appear only for operators who may see bookings;
 * everyone else sees the occupancy without the identity.
 */

const STATE_LABEL = {
  available: "Free",
  sold: "Sold",
  held: "In someone's checkout",
  blocked: "Blocked",
  reserved: "Held for another pair",
};

const STATE_SEVERITY = {
  available: "success",
  sold: "danger",
  held: "warning",
  blocked: "secondary",
  reserved: "info",
};

export default function SeatOccupancy({ tripId, fromStationId, toStationId, coachClassId, classes }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState("all");

  useEffect(() => {
    if (!tripId) return;
    setLoading(true);
    setError(null);

    fetchOccupancy({ tripId, fromStationId, toStationId, coachClassId })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tripId, fromStationId, toStationId, coachClassId]);

  /*
   * Coaches in coupling order, each with every seat it has.
   *
   * A search or a state filter fades the seats that do not match instead of
   * removing them: a coach with gaps punched in it no longer reads as a coach,
   * and "where in the train is this seat" is half of what the map is for.
   * Coaches with no match at all are left out.
   */
  const byCoach = useMemo(() => {
    if (!data?.seats) return [];

    const term = search.trim().toLowerCase();
    const matches = (seat) => {
      if (show !== "all" && seat.state !== show) return false;
      if (!term) return true;
      return [
        seat.seatNumber,
        seat.coachCode,
        ...seat.occupiedBy.flatMap((o) => [
          o.bookingReference,
          o.ticketNumber,
          o.passengerName,
          o.fromStation,
          o.toStation,
          o.reason,
        ]),
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    };

    const groups = new Map();
    for (const seat of data.seats) {
      const key = seat.tripCoachId;
      if (!groups.has(key)) {
        groups.set(key, { id: key, code: seat.coachCode || `Coach ${key}`, classId: seat.coachClassId, seats: [] });
      }
      groups.get(key).seats.push({ ...seat, matches: matches(seat) });
    }

    return [...groups.values()]
      .map((coach) => {
        const rows = Math.max(0, ...coach.seats.map((x) => x.rowIndex)) + 1;
        const cols = Math.max(0, ...coach.seats.map((x) => x.cellIndex)) + 1;
        return {
          ...coach,
          rows,
          cols,
          free: coach.seats.filter((x) => x.state === "available").length,
          matched: coach.seats.filter((x) => x.matches).length,
        };
      })
      .filter((coach) => coach.matched > 0);
  }, [data, search, show]);

  const classNameOf = useMemo(() => {
    const map = new Map((classes || []).map((c) => [c.id, c.name]));
    return (id) => map.get(id) || null;
  }, [classes]);

  if (loading) {
    return (
      <div className="occ-centre">
        <ProgressSpinner style={{ width: 34, height: 34 }} />
      </div>
    );
  }

  if (error) return <Message severity="error" text={error} />;
  if (!data) return null;

  const counts = [
    ["available", data.availableCount],
    ["sold", data.soldCount],
    ["held", data.heldCount],
    ["blocked", data.blockedCount],
    ["reserved", data.reservedCount],
  ].filter(([, n]) => n > 0);

  const shownSeats = byCoach.reduce((n, c) => n + c.matched, 0);
  const filtering = show !== "all" || Boolean(search.trim());

  return (
    <div className="occ">
      <div className="occ-summary" role="group" aria-label="Filter seats by state">
        {counts.map(([state, n]) => (
          <button
            key={state}
            type="button"
            className={`occ-count occ-count--${state}${show === state ? " is-chosen" : ""}`}
            onClick={() => setShow(show === state ? "all" : state)}
            aria-pressed={show === state}
            title={show === state ? "Show every seat again" : `Show only ${STATE_LABEL[state].toLowerCase()}`}
          >
            <i className={`occ-dot occ-${state}`} aria-hidden="true" />
            <strong>{n}</strong>
            <span>{STATE_LABEL[state]}</span>
          </button>
        ))}
        <span className="occ-total">{data.totalSeats} seats</span>
      </div>

      <div className="occ-toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Seat, booking reference, passenger or station"
          className="occ-search"
        />
        {filtering && (
          <Button
            label="Clear"
            icon="pi pi-times"
            text
            size="small"
            onClick={() => {
              setShow("all");
              setSearch("");
            }}
          />
        )}
        {/* The total is already in the summary above; only a filter changes it. */}
        {filtering && <span className="occ-shown">{shownSeats} match</span>}
      </div>

      <div className="occ-map">
        {byCoach.map((coach) => (
          <section key={coach.id} className="occ-coach">
            <header className="occ-coach__head">
              <span className="occ-coach__code">{coach.code}</span>
              {classNameOf(coach.classId) && (
                <span className="occ-coach__class">{classNameOf(coach.classId)}</span>
              )}
              <span className="occ-coach__free">
                <span
                  className="occ-coach__bar"
                  style={{ "--occ-fill": coach.seats.length ? coach.free / coach.seats.length : 0 }}
                  aria-hidden="true"
                />
                {coach.free} of {coach.seats.length} free
              </span>
            </header>

            {/* Drawn across the page, front row at the left, the way the
                coach runs past a platform. Each seat sits where the plan put
                it, so the aisle shows as a gap. */}
            <div className="occ-coach__scroll">
              <div
                className="occ-grid"
                style={{ "--occ-rows": coach.cols, "--occ-cols": coach.rows }}
                role="group"
                aria-label={`Coach ${coach.code}`}
              >
                {coach.seats.map((seat) => (
                  <button
                    key={seat.id}
                    type="button"
                    className={`occ-seat occ-${seat.state}${seat.matches ? "" : " is-dim"}`}
                    style={{ gridColumn: seat.rowIndex + 1, gridRow: seat.cellIndex + 1 }}
                    onClick={() => setChosen(seat)}
                    title={describe(seat)}
                    aria-label={describe(seat)}
                  >
                    {seat.seatNumber}
                  </button>
                ))}
              </div>
            </div>
          </section>
        ))}

        {byCoach.length === 0 && <p className="occ-empty">Nothing matches that.</p>}
      </div>

      <div className="occ-legend">
        {Object.entries(STATE_LABEL).map(([state, label]) => (
          <span key={state}>
            <i className={`occ-swatch occ-${state}`} aria-hidden="true" /> {label}
          </span>
        ))}
        <span className="occ-legend__hint">Open a seat to see who holds it, and for which stretch.</span>
      </div>

      <SeatDetail seat={chosen} onHide={() => setChosen(null)} />
    </div>
  );
}

/** What is on this seat, and where to look next. */
function SeatDetail({ seat, onHide }) {
  if (!seat) return null;

  // Everything on the seat anywhere on the route, not only what clashes with
  // the stretch being viewed — the fuller picture is usually what is wanted
  // once someone has clicked.
  const occupants = seat.allOccupants?.length ? seat.allOccupants : seat.occupiedBy;

  return (
    <Dialog
      header={`Coach ${seat.coachCode || "—"}, seat ${seat.seatNumber}`}
      visible={Boolean(seat)}
      onHide={onHide}
      className="occ-dialog"
      dismissableMask
      draggable={false}
    >
      <div className="occ-detail-head">
        <Tag value={STATE_LABEL[seat.state]} severity={STATE_SEVERITY[seat.state]} />
        {seat.attributes?.window && <Tag value="Window" severity="secondary" icon="pi pi-th-large" />}
        {seat.attributes?.charging_port && <Tag value="Charging port" severity="secondary" icon="pi pi-bolt" />}
      </div>

      {seat.quota && !seat.quota.isReleased && (
        <Message
          severity="info"
          className="occ-message"
          text={`Held for stops ${seat.quota.fromStationId}→${seat.quota.toStationId} until ${
            seat.quota.releaseAt ? new Date(seat.quota.releaseAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" }) : "departure"
          }`}
        />
      )}

      {occupants.length === 0 ? (
        <p className="occ-free">Nothing is on this seat anywhere along the route.</p>
      ) : (
        <ul className="occ-occupants">
          {occupants.map((o, i) => (
            <li key={i} className={`occ-occupant occ-${o.source}`}>
              <div className="occ-occupant__head">
                <strong>
                  {o.fromStation || "?"} → {o.toStation || "?"}
                </strong>
                <Tag
                  value={o.source === "ticket" ? "Sold" : o.source === "hold" ? "In checkout" : "Blocked"}
                  severity={o.source === "ticket" ? "danger" : o.source === "hold" ? "warning" : "secondary"}
                />
              </div>

              <dl className="occ-facts">
                {o.bookingReference && (
                  <div>
                    <dt>Booking</dt>
                    <dd className="occ-mono">{o.bookingReference}</dd>
                  </div>
                )}
                {o.ticketNumber && (
                  <div>
                    <dt>Ticket</dt>
                    <dd className="occ-mono">{o.ticketNumber}</dd>
                  </div>
                )}
                {o.passengerName && (
                  <div>
                    <dt>Passenger</dt>
                    <dd>{o.passengerName}</dd>
                  </div>
                )}
                {o.passengerNid && (
                  <div>
                    <dt>National ID</dt>
                    <dd className="occ-mono">…{String(o.passengerNid).slice(-4)}</dd>
                  </div>
                )}
                {o.boardingDate && (
                  <div>
                    <dt>Travelling</dt>
                    <dd>{o.boardingDate}</dd>
                  </div>
                )}
                {o.holdReference && (
                  <div>
                    <dt>Checkout</dt>
                    <dd className="occ-mono">{o.holdReference}</dd>
                  </div>
                )}
                {o.holdExpiresAt && (
                  <div>
                    <dt>Expires</dt>
                    <dd>
                      {new Date(o.holdExpiresAt).toLocaleString("en-GB", {
                        timeStyle: "short",
                        dateStyle: "short",
                        timeZone: "Asia/Dhaka",
                      })}
                    </dd>
                  </div>
                )}
                {o.reason && (
                  <div>
                    <dt>Reason</dt>
                    <dd>{o.reason}</dd>
                  </div>
                )}
                <div>
                  <dt>Segments</dt>
                  <dd className="occ-mono">{o.segments.join(", ")}</dd>
                </div>
              </dl>

              {o.ticketStatus && o.ticketStatus !== "valid" && (
                <p className="occ-note">This ticket is {o.ticketStatus}.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function describe(seat) {
  if (seat.state === "available") return `Seat ${seat.seatNumber} — free`;
  const o = seat.occupiedBy[0];
  if (!o) return `Seat ${seat.seatNumber} — ${STATE_LABEL[seat.state]}`;
  return `Seat ${seat.seatNumber} — ${STATE_LABEL[seat.state]}${
    o.fromStation ? `, ${o.fromStation} to ${o.toStation}` : ""
  }${o.bookingReference ? ` (${o.bookingReference})` : ""}`;
}
