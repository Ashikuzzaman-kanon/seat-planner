"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Toast } from "primereact/toast";
import { Message } from "primereact/message";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import JourneyStep from "@/components/booking/JourneyStep";
import SeatStep from "@/components/booking/SeatStep";
import PassengerStep from "@/components/booking/PassengerStep";
import PaymentStep from "@/components/booking/PaymentStep";
import ConfirmationStep from "@/components/booking/ConfirmationStep";
import { releaseHold, fetchHold, quoteHold } from "@/lib/booking";
import OpenCheckouts from "@/components/booking/OpenCheckouts";
import MyWaitlist from "@/components/booking/MyWaitlist";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import "@/components/booking/booking.css";

/**
 * Buying a ticket, start to finish.
 *
 * State lives here rather than in the steps because the steps are a sequence,
 * not a tree: the seats chosen in step two are what step three asks for
 * passengers against, and what step four prices. Keeping it in one place is
 * what lets going back actually undo something.
 *
 * Going back from the passenger step releases the hold rather than abandoning
 * it. Seats a passenger has walked away from should be on sale again within
 * seconds, not in ten minutes when the expiry job notices.
 */

const STEPS = [
  { label: "Journey" },
  { label: "Seats" },
  { label: "Passengers" },
  { label: "Payment" },
  { label: "Done" },
];

export default function BookPage() {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useRef(null);

  const [step, setStep] = useState(0);
  const [journey, setJourney] = useState({
    fromStationId: null,
    toStationId: null,
    date: null,
    count: 1,
  });
  const [departure, setDeparture] = useState(null);
  const [held, setHeld] = useState(null); // { hold, seats, note }
  const [passengers, setPassengers] = useState([]);
  const [booking, setBooking] = useState(null);

  const canBuy = hasPermission(PERMISSIONS.BOOKING_CREATE);
  const resuming = params.get("resume");

  /*
   * The hold this page made itself. Holding seats writes its reference into
   * the address bar (so a refresh can resume), and that change of address
   * would otherwise run the resume below against a checkout this page already
   * knows everything about — refetching it, and replacing the departure it
   * searched for with the thinner one a resume can rebuild.
   */
  const ownHold = useRef(null);

  /*
   * Picking a checkout back up.
   *
   * The seats were never lost — the hold is on the server and the timer is
   * still running. What was lost was this page's memory of it, which is why the
   * reference lives in the URL from the moment a hold exists: a refresh, a
   * shared link or a return from another tab all land back here.
   *
   * The quote is re-read rather than trusted: it carries the seats, the coaches
   * and the fares, and it is the same call the payment step makes anyway.
   */
  useEffect(() => {
    if (!resuming || !canBuy) return;
    if (ownHold.current === resuming) return;

    let cancelled = false;

    Promise.all([fetchHold(resuming), quoteHold(resuming)])
      .then(([hold, quote]) => {
        if (cancelled) return;
        if (!hold.isLive) {
          toast.current?.show({
            severity: "warn",
            summary: "That checkout has ended",
            detail: "Those seats went back on sale. Search again to pick new ones.",
            life: 8000,
          });
          router.replace("/dashboard/book");
          return;
        }

        setHeld({
          hold,
          seats: quote.lines.map((line) => ({
            id: line.tripSeatId,
            seatNumber: line.seatNumber,
            coachCode: line.coachCode,
          })),
          note: null,
        });
        setJourney((j) => ({
          ...j,
          fromStationId: hold.fromStationId,
          toStationId: hold.toStationId,
          count: hold.seatIds.length,
        }));
        setDeparture({ tripId: hold.tripId, train: quote.train });
        setStep(2);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.current?.show({
          severity: "warn",
          summary: "Could not pick that up",
          detail: err.message,
          life: 8000,
        });
        router.replace("/dashboard/book");
      });

    return () => {
      cancelled = true;
    };
  }, [resuming, canBuy, router]);

  const fail = useCallback((message) => {
    toast.current?.show({ severity: "error", summary: "Sorry", detail: message, life: 6000 });
  }, []);

  /** The hold lapsed while the passenger was filling something in. */
  const expired = useCallback(() => {
    setHeld(null);
    setPassengers([]);
    setStep(1);
    toast.current?.show({
      severity: "warn",
      summary: "Seats released",
      detail: "The checkout ran out of time and the seats went back on sale. Please choose again.",
      life: 8000,
    });
  }, []);

  /** Give the seats back instead of letting them sit idle until they expire. */
  const abandonHold = useCallback(async () => {
    if (!held?.hold?.reference) return;
    try {
      await releaseHold(held.hold.reference);
    } catch {
      // The expiry job will collect it shortly; nothing to tell the passenger.
    }
    setHeld(null);
    setPassengers([]);
  }, [held]);

  const backToSeats = () => {
    confirmDialog({
      message: "This releases the seats you are holding. Choose again?",
      header: "Give up these seats?",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Yes, choose again",
      rejectLabel: "Keep them",
      accept: async () => {
        await abandonHold();
        router.replace("/dashboard/book", { scroll: false });
        setStep(1);
      },
    });
  };

  if (!canBuy) {
    return (
      <div className="card">
        <h1 className="page-title">Book a ticket</h1>
        <p className="page-subtitle">
          Your account does not have permission to buy tickets.
        </p>
      </div>
    );
  }

  return (
    <div className="book-page">
      <Toast ref={toast} />
      <ConfirmDialog />

      <h1 className="page-title">Book a ticket</h1>
      <p className="page-subtitle">
        A seat is sold for the stretch you travel, so a train that looks full end to end may
        still have room on your part of the route.
      </p>

      <BookProgress step={step} />

      {step > 0 && step < 4 && departure && <BookSummary journey={journey} departure={departure} />}

      {step === 0 && <OpenCheckouts />}
      {step === 0 && <MyWaitlist />}

      {step === 0 && (
        <JourneyStep
          journey={journey}
          onChange={(patch) => setJourney((j) => ({ ...j, ...patch }))}
          onPick={(chosen) => {
            setDeparture(chosen);
            setStep(1);
          }}
          onError={fail}
        />
      )}

      {step === 1 && departure && (
        <SeatStep
          journey={journey}
          departure={departure}
          onHeld={(result) => {
            ownHold.current = result.hold.reference;
            setHeld(result);
            setStep(2);
            // From here the checkout survives a refresh, a closed tab, or a
            // walk to another page — the reference is in the address bar.
            router.replace(`/dashboard/book?resume=${result.hold.reference}`, { scroll: false });
          }}
          onBack={() => setStep(0)}
          onError={fail}
        />
      )}

      {step === 2 && held && (
        <PassengerStep
          hold={held.hold}
          seats={held.seats}
          note={held.note}
          onSubmit={(details) => {
            setPassengers(details);
            setStep(3);
          }}
          onBack={backToSeats}
          onExpire={expired}
        />
      )}

      {step === 3 && held && (
        <PaymentStep
          hold={held.hold}
          passengers={passengers}
          onPaid={(result) => {
            setBooking(result);
            setHeld(null);
            setStep(4);
            // The hold is spent; leaving it in the URL would offer to resume a
            // checkout that has already become a ticket.
            router.replace("/dashboard/book", { scroll: false });
          }}
          onBack={() => setStep(2)}
          onExpire={expired}
          onError={fail}
        />
      )}

      {step === 4 && booking && (
        <ConfirmationStep
          booking={booking}
          onDone={() => router.push("/dashboard/bookings")}
          onError={fail}
        />
      )}

      {step > 0 && step < 4 && !departure && (
        <Message
          severity="warn"
          className="book-message"
          text="Something went missing along the way. Start again from the journey."
        />
      )}
    </div>
  );
}

/**
 * Where the passenger is in the purchase.
 *
 * PrimeReact's Steps drew five bare numbers on a phone once its labels no
 * longer fitted, which says "step 2" without saying what step 2 is. This keeps
 * the dots, ticks off what is done, and on a phone names the current step in
 * words under them.
 */
function BookProgress({ step }) {
  return (
    <nav className="book-progress" aria-label="Booking progress">
      <ol>
        {STEPS.map((s, i) => (
          <li
            key={s.label}
            className={i < step ? "is-done" : i === step ? "is-now" : undefined}
            aria-current={i === step ? "step" : undefined}
          >
            <span className="book-progress__dot" aria-hidden="true">
              {i < step ? <i className="pi pi-check" /> : i + 1}
            </span>
            <span className="book-progress__label">
              {s.label}
              {i < step && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="book-progress__caption" aria-hidden="true">
        Step {step + 1} of {STEPS.length} · <strong>{STEPS[step]?.label}</strong>
      </p>
    </nav>
  );
}

/**
 * What is being bought, kept in view from the seat step to payment, so
 * nobody pays for the wrong train because the search is three screens back.
 * A resumed checkout knows less (no search ran), and shows what it has.
 */
function BookSummary({ journey, departure }) {
  const date = journey.date
    ? new Date(`${journey.date}T00:00:00+06:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "Asia/Dhaka",
      })
    : null;

  return (
    <div className="book-summary" aria-label="Your journey">
      {departure.train?.name && (
        <span className="book-summary__train">
          <i className="pi pi-ticket" aria-hidden="true" />
          {departure.train.name}
        </span>
      )}
      {departure.from?.name && departure.to?.name && (
        <span>
          {departure.from.name} <i className="pi pi-arrow-right" aria-hidden="true" /> {departure.to.name}
        </span>
      )}
      {departure.from?.time && (
        <span>
          <i className="pi pi-clock" aria-hidden="true" />
          {String(departure.from.time).slice(0, 5)}
        </span>
      )}
      {date && (
        <span>
          <i className="pi pi-calendar" aria-hidden="true" />
          {date}
        </span>
      )}
      <span>
        <i className="pi pi-users" aria-hidden="true" />
        {journey.count} seat{journey.count === 1 ? "" : "s"}
      </span>
    </div>
  );
}
