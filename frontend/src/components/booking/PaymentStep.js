"use client";

import { useEffect, useState } from "react";
import { Button } from "primereact/button";
import { Message } from "primereact/message";
import { RadioButton } from "primereact/radiobutton";
import { ProgressSpinner } from "primereact/progressspinner";
import { quoteHold, createBooking, formatTaka, PAYMENT_LABELS } from "@/lib/booking";
import HoldTimer from "./HoldTimer";
import FakeGatewayDialog from "@/components/payment/FakeGatewayDialog";

/**
 * Paying.
 *
 * The quote is re-fetched here rather than carried from the seat step: fares
 * are resolved server-side and this is the last moment before money moves, so
 * the number a passenger agrees to is the number the server just calculated.
 *
 * Nothing is taken until "Pay" — and if the gateway declines, the seats stay
 * held so the passenger can try another method rather than starting over.
 */
export default function PaymentStep({ hold, passengers, onPaid, onBack, onExpire, onError }) {
  const [quote, setQuote] = useState(null);
  const [method, setMethod] = useState(null);
  const [paying, setPaying] = useState(false);
  const [declined, setDeclined] = useState(null);
  const [atGateway, setAtGateway] = useState(false);

  useEffect(() => {
    quoteHold(hold.reference)
      .then((q) => {
        setQuote(q);
        // Default to whichever offered method can actually cover the fare.
        const usable = q.payment.options.find((o) => o.available);
        setMethod(usable?.method || "gateway");
      })
      .catch((err) => onError?.(err.message));
  }, [hold.reference, onError]);

  /*
   * Paying from the wallet is one click. Anything touching a card or a bank
   * goes through the gateway first, because that is what it costs in the real
   * world and pretending otherwise would flatter the wrong option.
   */
  const pay = () => {
    if (method === "wallet") return settle();
    setAtGateway(true);
  };

  const settle = async (gatewayToken) => {
    setAtGateway(false);
    setPaying(true);
    setDeclined(null);
    try {
      const booking = await createBooking({
        holdReference: hold.reference,
        passengers,
        method,
        gatewayToken,
      });
      onPaid(booking);
    } catch (err) {
      setDeclined(err.message);
      setPaying(false);
    }
  };

  if (!quote) {
    return (
      <div className="book-centre">
        <ProgressSpinner style={{ width: 36, height: 36 }} />
      </div>
    );
  }

  return (
    <div className="book-step">
      <div className="book-holdbar card">
        <div>
          <strong>Almost there</strong>
          <span className="book-holdbar__seats">
            {quote.lines.map((l) => `${l.coachCode || ""} ${l.seatNumber}`.trim()).join(" · ")}
          </span>
        </div>
        <HoldTimer expiresAt={hold.expiresAt} onExpire={onExpire} />
      </div>

      <section className="card payment-summary">
        <h3>What you are paying for</h3>

        <ul className="fare-lines">
          {quote.lines.map((line) => (
            <li key={line.tripSeatId}>
              <div>
                <strong>
                  Coach {line.coachCode || "—"} · seat {line.seatNumber}
                </strong>
                <small>{line.explanation}</small>
              </div>
              <span>৳ {line.fareFormatted}</span>
            </li>
          ))}
        </ul>

        <div className="fare-total">
          <span>Total</span>
          <strong>৳ {quote.totalFormatted}</strong>
        </div>
      </section>

      <section className="card payment-methods">
        <h3>How would you like to pay?</h3>

        {quote.payment.options.map((option) => (
          <label
            key={option.method}
            className={`payment-option${method === option.method ? " is-chosen" : ""}${
              option.available ? "" : " is-unavailable"
            }`}
          >
            <RadioButton
              inputId={option.method}
              name="method"
              value={option.method}
              checked={method === option.method}
              onChange={(e) => setMethod(e.value)}
              disabled={!option.available}
            />
            <div className="payment-option__body">
              <strong>{PAYMENT_LABELS[option.method] || option.label}</strong>
              <small>{option.detail}</small>
            </div>
          </label>
        ))}

        <p className="payment-wallet-note">
          Wallet balance: <strong>৳ {quote.payment.walletBalance}</strong>
        </p>

        {method === "wallet" && (
          <p className="wallet-oneclick">
            <i className="pi pi-bolt" aria-hidden="true" /> One click — no card details, no
            security question, no waiting.
          </p>
        )}
      </section>

      {declined && (
        <Message
          severity="error"
          className="book-message"
          text={`${declined} Your seats are still held — try another method.`}
        />
      )}

      <FakeGatewayDialog
        visible={atGateway}
        amountMinor={
          // On a split only the remainder goes to the gateway; the wallet
          // covers the rest, and showing the whole fare here would be a lie.
          method === "split"
            ? Math.max(0, quote.totalMinor - (quote.payment.walletBalanceMinor || 0))
            : quote.totalMinor
        }
        purpose="booking"
        onCancel={() => setAtGateway(false)}
        onAuthorised={settle}
      />

      <div className="book-nav">
        <Button label="Back" icon="pi pi-angle-left" text onClick={onBack} disabled={paying} />
        <Button
          label={`Pay ৳ ${quote.totalFormatted}`}
          icon="pi pi-lock"
          onClick={pay}
          loading={paying}
          disabled={!method}
        />
      </div>
    </div>
  );
}
