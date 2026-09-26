"use client";

import { useEffect, useState } from "react";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import { fetchTicketQr, openTicketPdf } from "@/lib/booking";

/**
 * What a passenger sees the moment the money has moved.
 *
 * The booking reference is the largest thing on the page, because it is the one
 * thing they will be asked for. The QR is shown inline rather than only inside
 * the PDF, so a phone can be held up at the gate without opening an attachment.
 */
export default function ConfirmationStep({ booking, onDone, onError }) {
  const [qrs, setQrs] = useState({});
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      (booking.tickets || []).map((t) =>
        fetchTicketQr({ bookingId: booking.id, ticketNumber: t.ticketNumber })
          .then((r) => [t.ticketNumber, r.dataUrl])
          .catch(() => [t.ticketNumber, null])
      )
    ).then((pairs) => {
      if (!cancelled) setQrs(Object.fromEntries(pairs));
    });

    return () => {
      cancelled = true;
    };
  }, [booking.id, booking.tickets]);

  const openPdf = async () => {
    setOpening(true);
    try {
      await openTicketPdf(booking.id);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="book-step">
      <section className="card confirm-head">
        <i className="pi pi-check-circle confirm-tick" aria-hidden="true" />
        <h2>Your tickets are confirmed</h2>

        <div className="confirm-reference">
          <span>Booking reference</span>
          <strong>{booking.reference}</strong>
        </div>

        <dl className="confirm-facts">
          <div>
            <dt>Train</dt>
            <dd>{booking.trip?.train?.name || "—"}</dd>
          </div>
          <div>
            <dt>Journey</dt>
            <dd>
              {booking.fromStation?.name} → {booking.toStation?.name}
            </dd>
          </div>
          <div>
            <dt>Travelling on</dt>
            <dd>
              {niceDate(booking.boardingDate || booking.trip?.departureDate)}
              {booking.nightsOnBoard > 0 && (
                <small className="confirm-overnight"> arrives {niceDate(booking.arrivalDate)}</small>
              )}
            </dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>৳ {booking.totalFormatted}</dd>
          </div>
        </dl>

        <div className="confirm-actions">
          <Button
            label="Open tickets (PDF)"
            icon="pi pi-file-pdf"
            onClick={openPdf}
            loading={opening}
          />
          <Button label="My bookings" icon="pi pi-list" outlined onClick={onDone} />
        </div>

        <Message
          severity="info"
          className="book-message"
          text="A copy has been emailed to you. Carry the National ID used for each ticket."
        />
      </section>

      <div className="ticket-grid">
        {(booking.tickets || []).map((ticket) => (
          <article key={ticket.ticketNumber} className="ticket-card">
            <header className="ticket-card__band">
              <span>
                <i className="pi pi-ticket" aria-hidden="true" />
                {booking.trip?.train?.name || "Ticket"}
              </span>
              <Tag value={ticket.status} severity={ticket.status === "valid" ? "success" : "warning"} />
            </header>

            <div className="ticket-card__body">
              <p className="ticket-card__route">
                {booking.fromStation?.name} <i className="pi pi-arrow-right" aria-hidden="true" />{" "}
                {booking.toStation?.name}
              </p>

              <div className="ticket-card__head">
                <div>
                  <span className="ticket-card__label">Coach</span>
                  <strong>{ticket.coachCode || "—"}</strong>
                </div>
                <div>
                  <span className="ticket-card__label">Seat</span>
                  <strong>{ticket.seatNumber}</strong>
                </div>
                <div>
                  <span className="ticket-card__label">Date</span>
                  <strong className="ticket-card__date">
                    {niceDate(booking.boardingDate || booking.trip?.departureDate, true)}
                  </strong>
                </div>
              </div>

              <p className="ticket-passenger">{ticket.passengerName}</p>
              <p className="ticket-number">{ticket.ticketNumber}</p>
            </div>

            <div className="ticket-card__tear" aria-hidden="true" />

            <div className="ticket-card__stub">
              {qrs[ticket.ticketNumber] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrs[ticket.ticketNumber]}
                  alt={`QR code for ticket ${ticket.ticketNumber}`}
                  className="ticket-qr"
                />
              ) : (
                <div className="ticket-qr ticket-qr--placeholder" aria-hidden="true" />
              )}
              <p className="ticket-fare">৳ {ticket.fareFormatted}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/** "Tue 29 Sep 2026" — or "29 Sep" where space is short. */
function niceDate(iso, short = false) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00+06:00`).toLocaleDateString("en-GB", {
    ...(short ? {} : { weekday: "short", year: "numeric" }),
    day: "numeric",
    month: "short",
    timeZone: "Asia/Dhaka",
  });
}
