"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { InputText } from "primereact/inputtext";
import SearchBox from "@/components/ui/SearchBox";
import { Checkbox } from "primereact/checkbox";
import { Paginator } from "primereact/paginator";
import { ProgressSpinner } from "primereact/progressspinner";
import { Dialog } from "primereact/dialog";
import {
  fetchBookings,
  fetchTicketQr,
  openTicketPdf,
  formatTaka,
} from "@/lib/booking";
import ReturnTicketDialog from "@/components/postsale/ReturnTicketDialog";
import TransferTicketDialog from "@/components/postsale/TransferTicketDialog";
import AddStandingDialog from "@/components/postsale/AddStandingDialog";
import OpenCheckouts from "@/components/booking/OpenCheckouts";
import MyWaitlist from "@/components/booking/MyWaitlist";
import "@/components/postsale/postsale.css";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import "@/components/booking/booking.css";

import { TIP } from "@/components/ui/tip";
/**
 * Everything bought so far.
 *
 * Cards rather than a table: a booking is read on a phone at a station, where
 * the reference and the seat matter far more than a tidy grid. Staff holding
 * `booking:view_all` get a toggle to see everyone's, which the API enforces
 * regardless of what this asks for.
 */
export default function BookingsPage() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [all, setAll] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [qrTicket, setQrTicket] = useState(null);
  const [returning, setReturning] = useState(null);
  const [transferring, setTransferring] = useState(null);
  const [extending, setExtending] = useState(null);

  const canBuy = hasPermission(PERMISSIONS.BOOKING_CREATE);
  const canViewAll = hasPermission(PERMISSIONS.BOOKING_VIEW_ALL);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchBookings({ page, all }));
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, [page, all]);

  useEffect(() => {
    load();
  }, [load]);

  const openPdf = async (booking) => {
    try {
      await openTicketPdf(booking.id);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    }
  };

  const notify = (severity, summary, detail) =>
    toast.current?.show({ severity, summary, detail, life: severity === "error" ? 7000 : 5000 });

  const showQr = async (booking, ticket) => {
    try {
      const { dataUrl } = await fetchTicketQr({
        bookingId: booking.id,
        ticketNumber: ticket.ticketNumber,
      });
      setQrTicket({ ...ticket, dataUrl, reference: booking.reference });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    }
  };

  if (!canBuy && !canViewAll) {
    return (
      <div className="card">
        <h1 className="page-title">My bookings</h1>
        <p className="page-subtitle">Your account cannot view bookings.</p>
      </div>
    );
  }

  // Filtered here rather than server-side: a page is at most twenty bookings,
  // and a round trip to narrow twenty rows would be slower than the typing.
  const term = search.trim().toLowerCase();
  const visible = (data?.bookings || []).filter((b) => {
    if (!term) return true;
    return [
      b.reference,
      b.trip?.train?.name,
      b.fromStation?.name,
      b.toStation?.name,
      b.trip?.departureDate,
      ...(b.tickets || []).flatMap((t) => [t.passengerName, t.ticketNumber, t.seatNumber]),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });

  return (
    <div>
      <Toast ref={toast} />

      <h1 className="page-title">{all ? "All bookings" : "My bookings"}</h1>
      <p className="page-subtitle">
        Your booking reference is what a ticket checker will ask for.
      </p>

      {/* Seats held but not yet paid for. Above everything, because the clock
          on them is running and nothing else here is urgent. */}
      {canBuy && <OpenCheckouts onChanged={load} />}
      {canBuy && <MyWaitlist onChanged={load} />}

      <div className="card bookings-toolbar">
        <SearchBox
                      value={search}
                      onChange={setSearch}
                      placeholder="Reference, train, station, passenger or seat"
                      className="bookings-search"
                    />

        {canViewAll && (
          <label className="bookings-toggle">
            <Checkbox
              inputId="all"
              checked={all}
              onChange={(e) => {
                setAll(e.checked);
                setPage(1);
              }}
            />
            <span>Everyone&apos;s bookings</span>
          </label>
        )}

        {canBuy && (
          <Link href="/dashboard/book" className="bookings-new">
            <Button label="Book a ticket" icon="pi pi-plus" size="small" />
          </Link>
        )}
      </div>

      {loading ? (
        <div className="book-centre">
          <ProgressSpinner style={{ width: 36, height: 36 }} />
        </div>
      ) : visible.length === 0 ? (
        <div className="card bookings-empty">
          <i className="pi pi-ticket" aria-hidden="true" />
          <p>
            {term
              ? "Nothing matches that search."
              : all
                ? "No bookings have been made yet."
                : "You have not booked anything yet."}
          </p>
          {canBuy && !term && (
            <Link href="/dashboard/book">
              <Button label="Book your first ticket" icon="pi pi-arrow-right" iconPos="right" />
            </Link>
          )}
        </div>
      ) : (
        <div className="bookings-list">
          {visible.map((booking) => (
            <article key={booking.id} className="card booking-row">
              <div className="booking-row__head">
                <div>
                  <span className="booking-ref">{booking.reference}</span>
                  <h3>{booking.trip?.train?.name || "Train"}</h3>
                  <p className="booking-journey">
                    <span>
                      {booking.fromStation?.name} <i className="pi pi-arrow-right" aria-hidden="true" />{" "}
                      {booking.toStation?.name}
                    </span>
                    <span className="booking-date">
                      <i className="pi pi-calendar" aria-hidden="true" />
                      {niceDate(booking.boardingDate || booking.trip?.departureDate)}
                      {booking.nightsOnBoard > 0 && (
                        <em className="booking-overnight"> · arrives {niceDate(booking.arrivalDate)}</em>
                      )}
                    </span>
                  </p>
                </div>

                <div className="booking-row__meta">
                  <Tag
                    value={booking.status.replace(/_/g, " ")}
                    severity={booking.status === "confirmed" ? "success" : "warning"}
                  />
                  <strong>৳ {booking.totalFormatted}</strong>
                </div>
              </div>

              <ul className="booking-tickets">
                {(booking.tickets || []).map((ticket) => {
                  const live = ticket.status === "valid";
                  return (
                    <li key={ticket.ticketNumber}>
                      <span className={`booking-seat${ticket.isStanding ? " is-standing" : ""}`} aria-hidden="true">
                        <small>{ticket.coachCode || "—"}</small>
                        <strong>{ticket.isStanding ? "ST" : ticket.seatNumber}</strong>
                      </span>
                      <div className="booking-ticket__who">
                        <strong>{ticket.passengerName}</strong>
                        <small>
                          {ticket.isStanding ? (
                            <>
                              <span className="ticket-standing">Standing</span> · coach{" "}
                              {ticket.coachCode || "—"} · {ticket.ticketNumber}
                            </>
                          ) : (
                            <>
                              Coach {ticket.coachCode || "—"} · seat {ticket.seatNumber} ·{" "}
                              {ticket.ticketNumber}
                            </>
                          )}
                        </small>
                      </div>

                      <div className="ticket-actions">
                        {!live && (
                          <Tag
                            value={ticket.status}
                            severity={ticket.status === "used" ? "info" : "secondary"}
                          />
                        )}
                        <Button tooltip="Show the QR code" tooltipOptions={TIP}
                          icon="pi pi-qrcode"
                          text
                          rounded
                          aria-label={`Show the QR code for ${ticket.passengerName}`}
                          onClick={() => showQr(booking, ticket)}
                          disabled={!live}
                        />
                        {canBuy && live && (
                          <>
                            {/*
                              Only on a seated ticket: standing is bought
                              against a seat, never against another standing leg.
                            */}
                            {!ticket.isStanding && (
                              <Button
                                icon="pi pi-arrows-h"
                                text
                                rounded
                                aria-label={`Travel further with the ticket for ${ticket.passengerName}`}
                                tooltip="Travel further — add standing"
                                tooltipOptions={TIP}
                                onClick={() => setExtending(ticket)}
                              />
                            )}
                            <Button
                              icon="pi pi-user-edit"
                              text
                              rounded
                              aria-label={`Transfer the ticket for ${ticket.passengerName}`}
                              tooltip="Transfer to another passenger"
                              tooltipOptions={TIP}
                              onClick={() => setTransferring(ticket)}
                            />
                            <Button
                              icon="pi pi-undo"
                              text
                              rounded
                              severity="danger"
                              aria-label={`Return the ticket for ${ticket.passengerName}`}
                              tooltip="Return this ticket"
                              tooltipOptions={TIP}
                              onClick={() => setReturning(ticket)}
                            />
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="booking-row__actions">
                <Button
                  label="Tickets (PDF)"
                  icon="pi pi-file-pdf"
                  size="small"
                  outlined
                  onClick={() => openPdf(booking)}
                />
                {(booking.payments || []).length > 0 && (
                  <span className="booking-paid">
                    Paid by{" "}
                    {booking.payments
                      .map((p) => `${p.provider} ${formatTaka(p.amountMinor)}`)
                      .join(" + ")}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {data?.pagination?.pages > 1 && (
        <Paginator
          first={(data.pagination.page - 1) * data.pagination.limit}
          rows={data.pagination.limit}
          totalRecords={data.pagination.total}
          onPageChange={(e) => setPage(Math.floor(e.first / e.rows) + 1)}
        />
      )}

      <AddStandingDialog
        ticket={extending}
        visible={Boolean(extending)}
        onHide={() => setExtending(null)}
        onError={(detail) => notify("error", "Could not add it", detail)}
        onBought={(result) => {
          setExtending(null);
          notify("success", "Standing added", result.message);
          load();
        }}
      />

      <ReturnTicketDialog
        ticket={returning}
        visible={Boolean(returning)}
        onHide={() => setReturning(null)}
        onError={(detail) => notify("error", "Could not return it", detail)}
        onReturned={(result) => {
          setReturning(null);
          notify("success", "Ticket returned", result.message);
          load();
        }}
      />

      <TransferTicketDialog
        ticket={transferring}
        visible={Boolean(transferring)}
        onHide={() => setTransferring(null)}
        onError={(detail) => notify("error", "Could not request it", detail)}
        onRequested={(result) => {
          setTransferring(null);
          notify("info", "Waiting for approval", result.message);
          load();
        }}
      />

      <Dialog
        visible={Boolean(qrTicket)}
        onHide={() => setQrTicket(null)}
        header={qrTicket ? `Seat ${qrTicket.seatNumber} — ${qrTicket.passengerName}` : ""}
        className="qr-dialog"
        dismissableMask
      >
        {qrTicket && (
          <div className="qr-dialog__body">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrTicket.dataUrl} alt={`QR code for ticket ${qrTicket.ticketNumber}`} />
            <p className="qr-dialog__number">{qrTicket.ticketNumber}</p>
            <p className="qr-dialog__hint">Show this to the ticket checker.</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** "Tue 29 Sep 2026" for a date-only value. */
function niceDate(iso) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00+06:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dhaka",
  });
}
