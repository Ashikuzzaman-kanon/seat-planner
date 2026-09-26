"use client";

import { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";
import { Tag } from "primereact/tag";
import { fetchStandingOptions, buyStanding } from "@/lib/postSale";
import { formatTaka } from "@/lib/booking";

/**
 * Travelling the whole way when the seat only covers part of it.
 *
 * Someone who could only secure a seat for the middle of their journey has
 * three options: abandon the booking, ride the ends unticketed, or stand. This
 * is the third, and it is why it exists.
 *
 * The seated leg is drawn in the middle with the two sides either end of it, so
 * the shape of the journey — and which bit is missing — is visible without
 * reading anything. A leg that cannot be sold stays on the list with the reason,
 * because "the coach is full over that stretch" and "that leg does not connect"
 * are different problems with different answers.
 */
export default function AddStandingDialog({ ticket, visible, onHide, onBought, onError }) {
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState(null);
  const [buying, setBuying] = useState(false);
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    if (!visible || !ticket) return;

    setOptions(null);
    setChosen(null);
    setProblem(null);
    setLoading(true);

    fetchStandingOptions(ticket.id)
      .then(setOptions)
      .catch((err) => setProblem(err.message))
      .finally(() => setLoading(false));
  }, [visible, ticket]);

  const buy = async () => {
    setBuying(true);
    setProblem(null);
    try {
      const result = await buyStanding({
        ticketId: ticket.id,
        fromStationId: chosen.fromStationId,
        toStationId: chosen.toStationId,
      });
      onBought(result);
    } catch (err) {
      setProblem(err.message);
      setBuying(false);
      // The coach may have filled while they were deciding, so re-read.
      fetchStandingOptions(ticket.id).then(setOptions).catch(() => {});
    }
  };

  const before = (options?.legs || []).filter((l) => l.position === "before");
  const after = (options?.legs || []).filter((l) => l.position === "after");

  return (
    <Dialog
      header={ticket ? `Travel further — seat ${ticket.seatNumber}` : "Add standing"}
      visible={visible}
      onHide={buying ? () => {} : onHide}
      className="standing-dialog"
      dismissableMask={!buying}
      draggable={false}
    >
      {loading && (
        <div className="book-centre">
          <ProgressSpinner style={{ width: 34, height: 34 }} />
        </div>
      )}

      {problem && <Message severity="warn" text={problem} className="book-message" />}

      {options && !options.sellsStanding && (
        <Message
          severity="info"
          className="book-message"
          text="Standing is not sold in this class of coach, so this seat cannot be extended."
        />
      )}

      {options && options.sellsStanding && (
        <>
          <p className="standing-intro">
            Your seat covers part of this train&apos;s route. You can buy standing room for the
            stretch either side of it, in the same coach, at{" "}
            <strong>{options.farePercent}% of the seated fare</strong>.
          </p>

          <div className="standing-journey">
            <span className="standing-journey__leg is-before">
              {before.length ? "before" : "—"}
            </span>
            <span className="standing-journey__seat">
              <strong>Seat {options.seat.seatNumber}</strong>
              <small>
                {options.seat.fromStation} → {options.seat.toStation}
              </small>
            </span>
            <span className="standing-journey__leg is-after">{after.length ? "after" : "—"}</span>
          </div>

          {options.held.length > 0 && (
            <div className="standing-held">
              <span className="standing-held__label">Already added</span>
              {options.held.map((t) => (
                <Tag key={t.ticketNumber} icon="pi pi-check" severity="success" value={t.ticketNumber} />
              ))}
            </div>
          )}

          <LegList
            title="Getting to your seat"
            hint="Board earlier and stand until your seat begins."
            legs={before}
            nameOf={(l) => `From ${l.fromStation}`}
            chosen={chosen}
            onChoose={setChosen}
          />

          <LegList
            title="Carrying on afterwards"
            hint="Stay aboard past your seat's destination, standing."
            legs={after}
            nameOf={(l) => `On to ${l.toStation}`}
            chosen={chosen}
            onChoose={setChosen}
          />

          {options.legs.every((l) => !l.available) && (
            <Message
              severity="info"
              className="book-message"
              text="Nothing can be added to this ticket at the moment. Each option above says why."
            />
          )}
        </>
      )}

      <div className="return-actions">
        <Button label="Close" text onClick={onHide} disabled={buying} />
        <Button
          label={chosen ? `Add for ${formatTaka(chosen.fareMinor)}` : "Add standing"}
          icon="pi pi-plus"
          onClick={buy}
          loading={buying}
          disabled={!chosen}
        />
      </div>
    </Dialog>
  );
}

function LegList({ title, hint, legs, nameOf, chosen, onChoose }) {
  if (!legs.length) return null;

  return (
    <section className="standing-legs">
      <h4>{title}</h4>
      <p className="standing-legs__hint">{hint}</p>

      <ul>
        {legs.map((leg) => {
          const key = `${leg.fromStationId}-${leg.toStationId}`;
          const isChosen =
            chosen && chosen.fromStationId === leg.fromStationId && chosen.toStationId === leg.toStationId;

          return (
            <li key={key}>
              <button
                type="button"
                className={`standing-leg${isChosen ? " is-chosen" : ""}${
                  leg.available ? "" : " is-unavailable"
                }`}
                onClick={() => leg.available && onChoose(leg)}
                disabled={!leg.available}
              >
                <span className="standing-leg__name">{nameOf(leg)}</span>

                {leg.available ? (
                  <>
                    <span className="standing-leg__fare">৳ {leg.fareFormatted}</span>
                    <small className="standing-leg__room">{leg.remaining} places left</small>
                  </>
                ) : (
                  <small className="standing-leg__blocked">{leg.message || "Not available"}</small>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
