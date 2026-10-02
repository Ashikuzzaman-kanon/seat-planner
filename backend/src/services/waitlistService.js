const { Op } = require("sequelize");
const {
  WaitlistEntry, Trip, TrainName, Station, CoachClass, User, SeatHold, TripSeat, TripCoach,
} = require("../models");
const { WAITLIST_STATUS, OPEN_STATUSES } = require("../models/WaitlistEntry");
const { TRIP_STATUS } = require("../models/Trip");
const { HOLD_STATUS } = require("../models/SeatHold");
const ApiError = require("../utils/ApiError");
const { waitlistReference, unique } = require("../utils/reference");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const audit = require("./auditService");
const settings = require("./settingService");
const availabilityService = require("./availabilityService");
const selectionService = require("./selectionService");
const holdService = require("./holdService");
const bookingService = require("./bookingService");
const walletService = require("./walletService");
const emailService = require("./emailService");
const ui = require("../emails/layout");
const notify = require("./notificationService");
const money = require("../utils/money");

/**
 * The queue for a stretch that is full (§12).
 *
 * ## What this is really for
 *
 * The demand-based return (§11.2) pays out only if the seat resells before the
 * train leaves. Left to chance, that depends on someone searching for that
 * exact stretch in the window between the return and the departure — which
 * makes the policy a lottery dressed as a choice. A queue turns "might resell"
 * into "resells within seconds", and so is what makes that return an honest
 * offer. Everything here is shaped by that: the point is not to record an
 * interest, it is to convert a returned seat before anybody else notices it.
 *
 * ## The order of operations when a seat comes back
 *
 * Hold first, then claim the entry. The reverse — claim, then hold — leaves an
 * entry marked as offered with no seat behind it if anything fails in between,
 * and nothing in the system would know to undo that. This way the worst case is
 * an orphaned hold, which the existing hold-expiry job already collects. Losing
 * a race costs a released hold; losing it the other way would cost a passenger
 * a seat that does not exist.
 *
 * ## What is not here
 *
 * No priority, no paid queue-jumping, no manual reordering. The queue is served
 * in the order people joined it, and that is the whole policy. A staff member
 * can watch it and cannot touch it, which is the point.
 */

/*
 * One sweep running per departure, and at most one waiting behind it.
 *
 * Two seats freeing at once should not send two sweeps racing through the same
 * queue. The obvious guard — drop the second — is wrong: a sweep asked for
 * *after* a seat was freed must actually see that seat, and dropping it tells
 * the caller "nothing found" about a state nobody looked at.
 *
 * So a request chains behind the one in flight. But chaining every request is
 * how the first version of this went wrong: holds are created and released
 * constantly on a busy departure, each release asking for a sweep, and the
 * queue grew without limit until anything that awaited a sweep was waiting on
 * hundreds of redundant passes.
 *
 * The fix is to collapse them, and it costs nothing. A sweep that has not
 * started yet will observe whatever the next caller commits, so a second one
 * queued behind it would find precisely the same thing. Everyone who asks
 * while a pass is pending gets that pass's result.
 *
 * Single-process, and honest about that: correctness does not depend on any of
 * it — the unique constraint on segments and the conditional claim in `offerTo`
 * are what actually stop a seat or an entry being handed out twice. This only
 * keeps the work from piling up.
 */
const running = new Map();
const pending = new Map();

/* ---------------- Reading ---------------- */

async function findOr404(reference) {
  const entry = await WaitlistEntry.findOne({ where: { reference } });
  if (!entry) throw ApiError.notFound("No such waitlist entry");
  return entry;
}

/** How many open entries sit ahead of this one. Derived, never stored. */
async function positionOf(entry) {
  if (entry.status !== WAITLIST_STATUS.WAITING) return null;
  const ahead = await WaitlistEntry.count({
    where: {
      tripId: entry.tripId,
      status: WAITLIST_STATUS.WAITING,
      id: { [Op.lt]: entry.id },
    },
  });
  return ahead + 1;
}

/**
 * Dress an entry for a passenger: the train, the stations, the class, and where
 * they stand. An entry that says "trip 79, station 4 to station 11" tells
 * someone nothing they can act on.
 */
async function decorate(entry, { includePosition = true } = {}) {
  const [trip, from, to, klass] = await Promise.all([
    Trip.findByPk(entry.tripId, { include: [{ model: TrainName, as: "train" }] }),
    Station.findByPk(entry.fromStationId),
    Station.findByPk(entry.toStationId),
    entry.coachClassId ? CoachClass.findByPk(entry.coachClassId) : null,
  ]);

  let offer = null;
  if (entry.status === WAITLIST_STATUS.OFFERED && entry.holdId) {
    const hold = await SeatHold.findByPk(entry.holdId);
    if (hold?.isLive) {
      const seats = await TripSeat.findAll({
        where: { id: hold.seatIds || [] },
        include: [{ model: TripCoach, as: "coach", attributes: ["coachCode"] }],
      });
      offer = {
        holdReference: hold.reference,
        seats: seats.map((s) => ({
          id: s.id,
          seatNumber: s.seatNumber,
          coachCode: s.coach?.coachCode || null,
        })),
      };
    }
  }

  return {
    ...entry.toPublicJSON(),
    train: trip?.train ? { id: trip.train.id, name: trip.train.name } : null,
    departureDate: trip?.departureDate || null,
    fromStation: from?.name || null,
    toStation: to?.name || null,
    coachClass: klass?.name || null,
    position: includePosition ? await positionOf(entry) : null,
    offer,
  };
}

/** Everything a passenger has queued for, open ones first. */
async function mine(userId) {
  const entries = await WaitlistEntry.findAll({
    where: { userId },
    order: [["id", "DESC"]],
    limit: 50,
  });
  const open = entries.filter((e) => e.isOpen);
  const rest = entries.filter((e) => !e.isOpen).slice(0, 10);
  return Promise.all([...open, ...rest].map((e) => decorate(e)));
}

async function get(reference, { userId, canViewAll = false } = {}) {
  const entry = await findOr404(reference);
  if (!canViewAll && entry.userId !== userId) {
    throw ApiError.forbidden("That queue place belongs to someone else");
  }
  return decorate(entry);
}

/** The queue on one departure, for someone watching how it converts. */
async function forTrip(tripId) {
  const entries = await WaitlistEntry.findAll({
    where: { tripId },
    order: [["id", "ASC"]],
    include: [
      { model: User, as: "user", attributes: ["id", "fullName", "email"] },
      { model: Station, as: "fromStation", attributes: ["id", "name"] },
      { model: Station, as: "toStation", attributes: ["id", "name"] },
      { model: CoachClass, as: "coachClass", attributes: ["id", "name"] },
    ],
  });

  let place = 0;
  const rows = entries.map((entry) => {
    if (entry.status === WAITLIST_STATUS.WAITING) place += 1;
    return {
      ...entry.toPublicJSON(),
      position: entry.status === WAITLIST_STATUS.WAITING ? place : null,
      // Names, not NIDs: watching a queue convert does not require knowing
      // anyone's identity documents.
      passenger: entry.user ? { name: entry.user.fullName, email: entry.user.email } : null,
      fromStation: entry.fromStation?.name || null,
      toStation: entry.toStation?.name || null,
      coachClass: entry.coachClass?.name || null,
    };
  });

  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  return {
    tripId: Number(tripId),
    entries: rows,
    counts,
    waiting: counts[WAITLIST_STATUS.WAITING] || 0,
    seatsWanted: rows
      .filter((r) => r.status === WAITLIST_STATUS.WAITING)
      .reduce((sum, r) => sum + r.seatCount, 0),
  };
}

/* ---------------- Joining ---------------- */

/**
 * Join the queue for a journey that is full.
 *
 * Refused when seats are actually available, and not out of pedantry: a queue
 * entry behind an open seat would sit there forever waiting for an offer that
 * the sweep will never make, because the sweep only runs when a seat *frees*.
 * The honest answer to "it is full" being wrong is "no it isn't — go and buy
 * one".
 */
async function join({ userId, tripId, fromStationId, toStationId, count = 1, coachClassId, passengers }) {
  if (!settings.get("waitlist.enabled")) {
    throw ApiError.badRequest("Waitlists are not being offered at the moment");
  }

  const trip = await Trip.findByPk(tripId, { include: [{ model: TrainName, as: "train" }] });
  if (!trip) throw ApiError.notFound("Departure not found");
  if (trip.status === TRIP_STATUS.CANCELLED) {
    throw ApiError.badRequest("This departure is cancelled");
  }

  const wanted = Number(count) || 1;
  const maximum = settings.get("booking.max_tickets_per_booking");
  if (wanted < 1 || wanted > maximum) {
    throw ApiError.badRequest(`Queue for between 1 and ${maximum} seats`);
  }

  // Same shape and same rules as buying, so a confirmed entry needs no further
  // validation at the moment it matters.
  const travellers = bookingService.validatePassengers(passengers, wanted);

  const alreadyHere = await WaitlistEntry.count({
    where: { userId, tripId, status: OPEN_STATUSES },
  });
  const perTrip = settings.get("waitlist.max_entries_per_trip");
  if (alreadyHere >= perTrip) {
    throw ApiError.badRequest(
      `You already have ${alreadyHere} open queue place(s) on this departure, which is the limit`
    );
  }

  const availability = await availabilityService.forJourney({
    tripId,
    fromStationId,
    toStationId,
    coachClassId: coachClassId || undefined,
  });
  if (availability.availableCount >= wanted) {
    throw ApiError.badRequest(
      `There ${availability.availableCount === 1 ? "is" : "are"} still ` +
        `${availability.availableCount} seat(s) for this journey — buy one rather than queueing`
    );
  }

  const reference = await unique(waitlistReference, async (candidate) =>
    Boolean(await WaitlistEntry.findOne({ where: { reference: candidate } }))
  );

  const entry = await WaitlistEntry.create({
    reference,
    tripId: trip.id,
    userId,
    fromStationId: Number(fromStationId),
    toStationId: Number(toStationId),
    seatCount: wanted,
    coachClassId: coachClassId ? Number(coachClassId) : null,
    passengers: travellers,
  });

  await audit.record({
    action: AUDIT_ACTIONS.WAITLIST_JOIN,
    entity: { type: "waitlist", id: entry.id, label: reference },
    after: { tripId: trip.id, seats: wanted, coachClassId: coachClassId || null },
    message: `joined the queue for ${wanted} seat(s) on ${trip.train?.name || `trip ${trip.id}`}`,
  });

  return decorate(entry);
}

/** Leave the queue. Releases an open offer with it. */
async function withdraw(reference, { userId, canViewAll = false } = {}) {
  const entry = await findOr404(reference);
  if (!canViewAll && entry.userId !== userId) {
    throw ApiError.forbidden("That queue place belongs to someone else");
  }
  if (!entry.isOpen) {
    return { reference, status: entry.status, alreadyClosed: true };
  }

  const hadOffer = entry.status === WAITLIST_STATUS.OFFERED;
  await closeWith(entry, WAITLIST_STATUS.WITHDRAWN, "Left the queue");

  await audit.record({
    action: AUDIT_ACTIONS.WAITLIST_WITHDRAW,
    entity: { type: "waitlist", id: entry.id, label: reference },
    after: { status: WAITLIST_STATUS.WITHDRAWN },
    message: `left the queue${hadOffer ? ", giving up an open offer" : ""}`,
  });

  // A given-up offer is a seat that must go straight back to the queue.
  if (hadOffer) seatsFreed(entry.tripId, "offer given up");

  return { reference, status: WAITLIST_STATUS.WITHDRAWN, releasedOffer: hadOffer };
}

/**
 * Close an entry, releasing whatever it was holding.
 *
 * Every terminal path goes through here so that no path can forget the hold —
 * a waitlist that leaks holds takes seats out of sale permanently, which is the
 * opposite of what it is for.
 */
async function closeWith(entry, status, note) {
  if (entry.holdId) {
    const hold = await SeatHold.findByPk(entry.holdId);
    if (hold && hold.status === HOLD_STATUS.ACTIVE) {
      await holdService.release(hold.reference).catch(() => {});
    }
  }
  await entry.update({
    status,
    holdId: null,
    offerExpiresAt: null,
    closedAt: new Date(),
    note: note || entry.note,
  });
}

/* ---------------- Offering ---------------- */

/**
 * Look for seats for everyone waiting on a departure.
 *
 * Called whenever seats come back — a return, a released or expired checkout, a
 * withdrawn offer — and on a timer as a safety net, because a missed sweep is a
 * seat sitting unsold next to a queue of people who want it.
 *
 * Entries that cannot be served are skipped rather than blocking the queue: one
 * seat coming free should go to the next person who wants one seat, not sit
 * idle because the person at the front wants four.
 */
async function sweep(tripId, { reason = "seats freed" } = {}) {
  if (!settings.get("waitlist.enabled")) return { tripId, offered: 0, skipped: "disabled" };

  const id = Number(tripId);

  // Nothing happening: run now.
  const active = running.get(id);
  if (!active) {
    const run = runSweep(id, reason).finally(() => {
      if (running.get(id) === run) running.delete(id);
    });
    running.set(id, run);
    return run;
  }

  // A pass is already queued to start after the current one. It has not looked
  // at anything yet, so it will see what this caller just committed — share it.
  const queued = pending.get(id);
  if (queued) return queued;

  const next = active
    .catch(() => {})
    .then(() => {
      // Promoted from pending to running as it starts.
      pending.delete(id);
      const run = runSweep(id, reason).finally(() => {
        if (running.get(id) === run) running.delete(id);
      });
      running.set(id, run);
      return run;
    });

  pending.set(id, next);
  return next;
}

/** One pass over a departure's queue. Always called through `sweep`. */
async function runSweep(id, reason) {
  const trip = await Trip.findByPk(id, { include: [{ model: TrainName, as: "train" }] });
  if (!trip || trip.status === TRIP_STATUS.CANCELLED) {
    return { tripId: id, offered: 0, skipped: "no live departure" };
  }

  const waiting = await WaitlistEntry.findAll({
    where: { tripId: id, status: WAITLIST_STATUS.WAITING },
    order: [["id", "ASC"]],
  });
  if (!waiting.length) return { tripId: id, offered: 0, reason };

  const offered = [];
  for (const entry of waiting) {
    const made = await offerTo(entry, trip).catch(() => null);
    if (made) offered.push(made);
  }

  return { tripId: id, offered: offered.length, entries: offered, reason };
}

/**
 * Try to put a seat in one passenger's name.
 *
 * Returns null when there is nothing for them, which is the ordinary case and
 * not an error — most sweeps find nothing for most of the queue.
 */
async function offerTo(entry, trip) {
  const minutes = settings.get("waitlist.offer_minutes");

  let held;
  try {
    held = await selectionService.selectAndHold({
      tripId: entry.tripId,
      userId: entry.userId,
      fromStationId: entry.fromStationId,
      toStationId: entry.toStationId,
      count: entry.seatCount,
      coachClassId: entry.coachClassId || undefined,
      // Being in a queue is already a compromise; insisting on adjacency on top
      // of it would mean turning down seats a waiting passenger would take.
      together: entry.seatCount > 1,
      strict: false,
      holdMinutes: minutes,
    });
  } catch {
    return null; // Nothing free for this journey. Ordinary.
  }

  /*
   * Claim the entry only now, and only if it is still waiting.
   *
   * The conditional update is the actual guard against two sweeps offering the
   * same person the same thing twice — the in-process lock above is a courtesy,
   * this is the correctness.
   */
  const [claimed] = await WaitlistEntry.update(
    {
      status: WAITLIST_STATUS.OFFERED,
      holdId: held.hold.id,
      offerExpiresAt: held.hold.expiresAt,
      offersMade: entry.offersMade + 1,
    },
    { where: { id: entry.id, status: WAITLIST_STATUS.WAITING } }
  );

  if (!claimed) {
    // Someone else got there first. Give the seat straight back rather than
    // letting it sit out the offer window for nobody.
    await holdService.release(held.hold.reference).catch(() => {});
    return null;
  }

  await entry.reload();

  await audit.record({
    action: AUDIT_ACTIONS.WAITLIST_OFFER,
    entity: { type: "waitlist", id: entry.id, label: entry.reference },
    after: {
      holdReference: held.hold.reference,
      seats: held.seats.length,
      expiresAt: held.hold.expiresAt,
    },
    message:
      `offered ${held.seats.length} seat(s) on ${trip.train?.name || `trip ${trip.id}`}, ` +
      `held for ${minutes} minutes`,
  });

  notifyOffer(entry, trip, held, minutes).catch(() => {});

  return {
    reference: entry.reference,
    userId: entry.userId,
    seats: held.seats.length,
    holdReference: held.hold.reference,
    expiresAt: held.hold.expiresAt,
  };
}

/**
 * Tell them, by email, because they are not looking at the site.
 *
 * The whole premise of an offer window measured in an hour rather than ten
 * minutes is that the passenger has gone away. A queue that only notifies
 * in-app is a queue that mostly lapses.
 */
async function notifyOffer(entry, trip, held, minutes) {
  const user = await User.findByPk(entry.userId);
  if (!user?.email) return;

  const [from, to] = await Promise.all([
    Station.findByPk(entry.fromStationId),
    Station.findByPk(entry.toStationId),
  ]);

  const plural = held.seats.length === 1 ? "" : "s";

  const subject = `A seat came free — ${trip.train?.name || "your train"}, ${entry.reference}`;
  await emailService.sendMail({
    to: user.email,
    subject,
    html: ui.page({
      subject,
      preheader: `Held for you for ${minutes} minutes — confirm in one click.`,
      eyebrow: "Waitlist",
      tone: "success",
      title: "A seat came free",
      intro: `You queued for this journey, and ${held.seats.length === 1 ? "a seat is" : "seats are"} now held in your name.`,
      body:
        ui.journey({
          from: from?.name || "your journey",
          to: to?.name || "",
          train: trip.train?.name || "this train",
          date: trip.departureDate,
        }) +
        ui.sectionTitle(`Held for you (${held.seats.length})`) +
        ui.chips(held.seats.map((s) => `${s.coachCode ? `Coach ${s.coachCode} · ` : ""}Seat ${s.seatNumber}`), {
          tone: "success",
        }) +
        ui.callout(
          `The seat${plural} will go back on sale in ${minutes} minutes if you do not confirm. ` +
            "Confirming takes one click and is paid from your wallet balance.",
          { tone: "warning", title: `Confirm within ${minutes} minutes` }
        ) +
        ui.button("Confirm your seat" + plural, ui.appUrl("/dashboard/bookings"), { tone: "success" }) +
        ui.paragraph(
          `Queue reference ${entry.reference}. If you no longer want it, declining passes it straight to the next person waiting.`,
          { muted: true, size: 14 }
        ),
    }),
  });
}

/* ---------------- Answering an offer ---------------- */

/** The open offer on an entry, or a plain refusal saying why there isn't one. */
async function liveOffer(reference, userId) {
  const entry = await findOr404(reference);
  if (entry.userId !== userId) throw ApiError.forbidden("That offer belongs to someone else");
  if (entry.status !== WAITLIST_STATUS.OFFERED || !entry.holdId) {
    throw ApiError.badRequest("There is no open offer on this queue place");
  }

  const hold = await SeatHold.findByPk(entry.holdId);
  if (!hold?.isLive) {
    throw ApiError.badRequest("That offer has expired and the seats have gone back on sale");
  }
  return { entry, hold };
}

/** What the offer will cost, and whether the wallet covers it. */
async function quote(reference, { userId }) {
  const { hold } = await liveOffer(reference, userId);
  return bookingService.quote({ holdReference: hold.reference, userId });
}

/**
 * Take the seat. One click.
 *
 * Wallet only, and deliberately: a card flow is several screens and a redirect,
 * which is exactly the friction this whole feature exists to remove. A
 * passenger whose balance is short is told the shortfall and can top up — the
 * offer is still theirs until it expires.
 */
async function confirm(reference, { userId }) {
  const { entry, hold } = await liveOffer(reference, userId);

  const priced = await bookingService.quote({ holdReference: hold.reference, userId });
  const wallet = await walletService.forUser(userId);
  if (wallet.balanceMinor < priced.totalMinor) {
    const short = priced.totalMinor - wallet.balanceMinor;
    throw ApiError.badRequest(
      `Your wallet is ${money.format(short)} short of the ${money.format(priced.totalMinor)} fare. ` +
        "Top up and confirm again — the offer is yours until it expires."
    );
  }

  const result = await bookingService.create({
    userId,
    holdReference: hold.reference,
    // Captured when they joined, which is what makes this one click.
    passengers: entry.passengers,
    method: "wallet",
  });

  const booking = result.booking || result;

  await entry.update({
    status: WAITLIST_STATUS.CONFIRMED,
    bookingId: booking.id || null,
    holdId: null,
    offerExpiresAt: null,
    closedAt: new Date(),
    note: "Took the offered seat",
  });

  await audit.record({
    action: AUDIT_ACTIONS.WAITLIST_CONFIRM,
    entity: { type: "waitlist", id: entry.id, label: entry.reference },
    after: { bookingReference: booking.reference },
    message: `took ${entry.seatCount} offered seat(s) from the queue`,
  });

  return result;
}

/** No thanks. The seat goes to the next person immediately. */
async function decline(reference, { userId }) {
  const entry = await findOr404(reference);
  if (entry.userId !== userId) throw ApiError.forbidden("That offer belongs to someone else");
  if (entry.status !== WAITLIST_STATUS.OFFERED) {
    throw ApiError.badRequest("There is no open offer on this queue place");
  }

  /*
   * Did the seat reach someone else?
   *
   * Not "did this call's sweep offer it" — releasing the hold tells the queue a
   * seat is free on its own, so by the time this sweep runs the seat has often
   * gone already and this pass legitimately offers nothing. Counting the open
   * offers on the departure either side of the whole operation measures the
   * thing the passenger actually asked about.
   *
   * Taken before the release, because the release is what starts the handover.
   */
  const othersOffered = () =>
    WaitlistEntry.count({
      where: {
        tripId: entry.tripId,
        status: WAITLIST_STATUS.OFFERED,
        id: { [Op.ne]: entry.id },
      },
    });
  const before = await othersOffered();

  await closeWith(entry, WAITLIST_STATUS.DECLINED, "Turned the offer down");

  await audit.record({
    action: AUDIT_ACTIONS.WAITLIST_DECLINE,
    entity: { type: "waitlist", id: entry.id, label: reference },
    after: { status: WAITLIST_STATUS.DECLINED },
    message: "turned down an offered seat",
  });

  // Chains behind the sweep the hold release started, so this returns only once
  // the queue has genuinely settled.
  await sweep(entry.tripId, { reason: "offer declined" }).catch(() => null);

  return {
    reference,
    status: WAITLIST_STATUS.DECLINED,
    passedOn: (await othersOffered()) > before,
  };
}

/* ---------------- Jobs ---------------- */

/**
 * Close offers nobody answered, and pass the seats on.
 *
 * An unanswered offer is worse than no offer: the seat was out of sale for the
 * whole window. So a passenger who lets several lapse leaves the queue, and
 * their place goes to someone who will answer.
 */
async function expireOffers({ now = new Date() } = {}) {
  const due = await WaitlistEntry.findAll({
    where: {
      status: WAITLIST_STATUS.OFFERED,
      offerExpiresAt: { [Op.lte]: now },
    },
  });
  if (!due.length) return { lapsed: 0, requeued: 0, swept: 0 };

  const limit = settings.get("waitlist.max_open_offers_missed");
  const trips = new Set();
  let requeued = 0;
  let closed = 0;

  for (const entry of due) {
    trips.add(entry.tripId);

    // The hold has lapsed on its own by now, but release explicitly rather than
    // waiting for the hold job: the seat should be back on sale at the same
    // moment the offer closes, not a minute later.
    if (entry.holdId) {
      const hold = await SeatHold.findByPk(entry.holdId);
      if (hold?.status === HOLD_STATUS.ACTIVE) {
        await holdService.release(hold.reference).catch(() => {});
      }
    }

    /*
     * Say so either way.
     *
     * The passenger may never have seen the offer at all, and the consequence
     * differs: either they kept their place, or their allowance is used up and
     * they have left the queue. Telling only the first group would mean the
     * people who most need to know hear nothing.
     */
    const [from, to] = await Promise.all([
      Station.findByPk(entry.fromStationId),
      Station.findByPk(entry.toStationId),
    ]);
    const trip = await Trip.findByPk(entry.tripId, {
      include: [{ model: TrainName, as: "train" }],
    });
    const described = {
      reference: entry.reference,
      train: trip?.train?.name || null,
      journey: [from?.name, to?.name].filter(Boolean).join(" \u2192 "),
      departureDate: trip?.departureDate || null,
    };

    if (entry.offersMade >= limit) {
      await entry.update({
        status: WAITLIST_STATUS.LAPSED,
        holdId: null,
        offerExpiresAt: null,
        closedAt: new Date(),
        note: `Left the queue after ${entry.offersMade} unanswered offer(s)`,
      });
      closed += 1;
      await audit.record({
        action: AUDIT_ACTIONS.WAITLIST_LAPSE,
        entity: { type: "waitlist", id: entry.id, label: entry.reference },
        after: { offersMade: entry.offersMade },
        message: `left the queue after ${entry.offersMade} unanswered offer(s)`,
      });
      notify.waitlistOfferExpired({
        userId: entry.userId,
        entry: described,
        stillQueued: false,
        offersMade: entry.offersMade,
        limit,
      });
    } else {
      // Back in line, keeping their original place: they joined when they
      // joined, and one missed email should not send them to the back.
      await entry.update({
        status: WAITLIST_STATUS.WAITING,
        holdId: null,
        offerExpiresAt: null,
        note: `Offer ${entry.offersMade} expired unanswered`,
      });
      requeued += 1;
      notify.waitlistOfferExpired({
        userId: entry.userId,
        entry: described,
        stillQueued: true,
        offersMade: entry.offersMade,
        limit,
      });
    }
  }

  let swept = 0;
  for (const tripId of trips) {
    const result = await sweep(tripId, { reason: "offer expired" }).catch(() => null);
    swept += result?.offered || 0;
  }

  return { lapsed: closed, requeued, swept };
}

/**
 * Close queues for trains that have gone.
 *
 * Nobody is waiting for a seat on a departed train, and an entry left open
 * would be swept forever.
 */
async function closeDeparted({ now = new Date() } = {}) {
  const open = await WaitlistEntry.findAll({
    where: { status: OPEN_STATUSES },
    include: [{ model: Trip, as: "trip" }],
  });

  let closed = 0;
  for (const entry of open) {
    const trip = entry.trip;
    const gone =
      !trip ||
      trip.status === TRIP_STATUS.CANCELLED ||
      (trip.departureDate && new Date(`${trip.departureDate}T23:59:59`) < now);
    if (!gone) continue;

    await closeWith(
      entry,
      WAITLIST_STATUS.CLOSED,
      trip?.status === TRIP_STATUS.CANCELLED ? "Departure cancelled" : "Departure has gone"
    );
    closed += 1;

    await audit.record({
      action: AUDIT_ACTIONS.WAITLIST_CLOSE,
      entity: { type: "waitlist", id: entry.id, label: entry.reference },
      after: { status: WAITLIST_STATUS.CLOSED },
      message: "queue place closed with its departure",
    });
  }

  return { closed };
}

/**
 * Seats came back on a departure — see who wants them.
 *
 * The callers are refunds, released checkouts and expired checkouts, and they
 * all call this *after* their transaction has committed. Calling it from inside
 * one would sweep against segments that are still occupied as far as any other
 * connection is concerned, find nothing, and quietly do nothing at all.
 */
function seatsFreed(tripId, reason) {
  if (!tripId) return;
  // Deliberately not awaited: whoever freed the seat is answering a request of
  // their own, and should not wait on a queue being served to get their answer.
  sweep(tripId, { reason }).catch(() => {});
}

module.exports = {
  join,
  mine,
  get,
  forTrip,
  withdraw,
  quote,
  confirm,
  decline,
  sweep,
  seatsFreed,
  expireOffers,
  closeDeparted,
  positionOf,
  // For the email preview (tools/preview-emails.js).
  notifyOffer,
  WAITLIST_STATUS,
};
