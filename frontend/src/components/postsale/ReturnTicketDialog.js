"use client";

import { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";
import { quoteRefund, requestRefund, REFUSAL_HINTS } from "@/lib/postSale";
import { formatTaka } from "@/lib/booking";

/**
 * Choosing how to give a ticket back.
 *
 * Both policies are shown together, priced, whether or not each is available —
 * because the choice only makes sense side by side. Near departure the
 * convenient return pays nothing while the demand-based one can still pay most
 * of the fare; far from it the reverse is true. A list that quietly dropped the
 * unavailable option would leave a passenger wondering what they were missing.
 *
 * An option that cannot be used says why in its own card, rather than being
 * hidden or greyed out with no explanation.
 */
export default function ReturnTicketDialog({ ticket, visible, onHide, onReturned, onError }) {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [blocked, setBlocked] = useState(null);

  useEffect(() => {
    if (!visible || !ticket) return;

    setQuote(null);
    setChosen(null);
    setBlocked(null);
    setLoading(true);

    quoteRefund(ticket.id)
      .then((q) => {
        setQuote(q);
        const usable = q.options.find((o) => o.ok);
        if (usable) setChosen(usable.type);
      })
      // A ticket already returned, or used, answers here rather than with an
      // empty dialog.
      .catch((err) => setBlocked(err.message))
      .finally(() => setLoading(false));
  }, [visible, ticket]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const result = await requestRefund({ ticketId: ticket.id, type: chosen });
      onReturned(result);
    } catch (err) {
      onError?.(err.message);
      setSubmitting(false);
    }
  };

  const option = quote?.options.find((o) => o.type === chosen);

  return (
    <Dialog
      header={ticket ? `Return seat ${ticket.seatNumber} — ${ticket.passengerName}` : "Return ticket"}
      visible={visible}
      onHide={submitting ? () => {} : onHide}
      className="return-dialog"
      dismissableMask={!submitting}
      draggable={false}
    >
      {loading && (
        <div className="book-centre">
          <ProgressSpinner style={{ width: 36, height: 36 }} />
        </div>
      )}

      {blocked && <Message severity="warn" text={blocked} className="book-message" />}

      {quote && (
        <>
          <dl className="return-facts">
            <div>
              <dt>Fare paid</dt>
              <dd>৳ {quote.fareFormatted}</dd>
            </div>
            <div>
              <dt>Departs in</dt>
              <dd>{describeHours(quote.hoursRemaining)}</dd>
            </div>
            <div>
              <dt>Segments</dt>
              <dd>{quote.segmentCount}</dd>
            </div>
          </dl>

          <div className="return-options">
            {quote.options.map((o) => (
              <ReturnOption
                key={o.type}
                option={o}
                chosen={chosen === o.type}
                onChoose={() => o.ok && setChosen(o.type)}
              />
            ))}
          </div>

          {quote.options.every((o) => !o.ok) && (
            <Message
              severity="info"
              className="book-message"
              text="This ticket cannot be returned at the moment. The reasons are on each option above."
            />
          )}
        </>
      )}

      <div className="return-actions">
        <Button label="Keep the ticket" text onClick={onHide} disabled={submitting} />
        <Button
          label={
            option?.immediate
              ? `Return for ${formatTaka(option.refundMinor)}`
              : option
                ? `Put the seat back on sale`
                : "Return"
          }
          icon="pi pi-undo"
          onClick={submit}
          loading={submitting}
          disabled={!option?.ok}
          severity={option?.immediate ? undefined : "warning"}
        />
      </div>
    </Dialog>
  );
}

function ReturnOption({ option, chosen, onChoose }) {
  const unavailable = !option.ok;

  return (
    <button
      type="button"
      className={`return-option${chosen ? " is-chosen" : ""}${unavailable ? " is-unavailable" : ""}`}
      onClick={onChoose}
      disabled={unavailable}
      aria-pressed={chosen}
    >
      <div className="return-option__head">
        <strong>{option.label}</strong>
        {option.ok ? (
          <span className="return-option__amount">
            {option.immediate ? formatTaka(option.refundMinor) : `up to ${formatTaka(option.maximumMinor)}`}
          </span>
        ) : (
          <span className="return-option__blocked">Not available</span>
        )}
      </div>

      <p className="return-option__describe">{option.describe}</p>

      {option.ok ? (
        <>
          <p className="return-option__detail">
            {option.immediate
              ? `${option.percent}% deducted — ${formatTaka(option.deductionMinor)}. Paid to your wallet now.`
              : `${option.percent}% processing charge. Paid only for the segments that resell; nothing for those that do not.`}
          </p>
          {!option.immediate && option.segmentCount > 1 && (
            <p className="return-option__detail return-option__detail--muted">
              The {option.segmentCount} segments refund independently, as each one sells.
            </p>
          )}
        </>
      ) : (
        <p className="return-option__detail return-option__detail--blocked">
          {REFUSAL_HINTS[option.reason] || option.message}
        </p>
      )}
    </button>
  );
}

function describeHours(hours) {
  if (!hours || hours <= 0) return "already gone";
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  if (hours >= 2) return `${Math.floor(hours)} hours`;
  return `${Math.max(1, Math.round(hours * 60))} minutes`;
}
