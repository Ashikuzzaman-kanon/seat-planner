// The two notification paths the main wiring suite cannot reach from the API
// alone: a departure cancelled by the railway, and a waitlist offer nobody
// answered.
//
// ## Why these are handled separately, and carefully
//
// Cancelling a departure refunds *every* ticket on it. Run casually that would
// silently refund whatever the person using this system had bought while
// testing. So this suite picks a departure, refuses to touch it unless the only
// tickets on it are the one it just bought itself, and reinstates it afterwards.
//
// The lapsed offer needs no waiting: `expireOffers` takes a `now`, so a clock
// an hour ahead is passed in rather than sleeping through a real offer window.
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize, Trip, Ticket, Booking, TripSeat, SeatSegmentBooking, User } =
  require(`${BACKEND}/src/models`);
const { TICKET_STATUS } = require(`${BACKEND}/src/models/Ticket`);
const { SEGMENT_SOURCE } = require(`${BACKEND}/src/models/SeatSegmentBooking`);
const emailService = require(`${BACKEND}/src/services/emailService`);
const notificationService = require(`${BACKEND}/src/services/notificationService`);
const { Job } = require(`${BACKEND}/src/models`);
const refundService = require(`${BACKEND}/src/services/refundService`);
const waitlistService = require(`${BACKEND}/src/services/waitlistService`);
const tripService = require(`${BACKEND}/src/services/tripService`);
const inventory = require(`${BACKEND}/src/services/inventoryService`);
const settings = require(`${BACKEND}/src/services/settingService`);

const BASE = process.env.API_BASE;
const MINE = "notify disruption suite";

let pass = 0;
let fail = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what} ${ok ? "" : note}`);
  ok ? pass++ : fail++;
};

/* ---------------- Catch what would have been sent ---------------- */

const sent = [];
const realSendMail = emailService.sendMail;
emailService.sendMail = async (message) => {
  sent.push(message);
  return true;
};
const bodyOf = (m) => String(m?.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* not json */
  }
  return { status: res.status, body: json, raw };
};

const login = async (email) => {
  const r = await call("POST", "/auth/login", { body: { email, password: "UnitTest123!" } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.raw.slice(0, 200)}`);
  return r.body.accessToken;
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const unblock = () =>
  SeatSegmentBooking.destroy({ where: { source: SEGMENT_SOURCE.BLOCK, reason: MINE } });

let cancelledTripId = null;

(async () => {
  await settings.loadSettings();

  const buyer = await login("unittest-user@example.com");
  const queuer = await login("unittest-target@example.com");
  const buyerUser = await User.findOne({ where: { email: "unittest-user@example.com" } });
  const queuerUser = await User.findOne({ where: { email: "unittest-target@example.com" } });

  await call("POST", "/wallet/topup", { token: buyer, body: { amount: 20000 } });

  const stations = (await call("GET", "/search/stations", { token: buyer })).body.stations;
  const dates = (await call("GET", "/search/dates?days=14", { token: buyer })).body.dates;

  /* ================================================================= *
   * A departure the railway cancels
   * ================================================================= */

  console.log("\n== a cancelled departure tells every passenger ==");

  /*
   * The furthest-out dates first, and only a departure carrying no tickets at
   * all. Cancelling refunds everyone on board, and doing that to somebody's
   * real test bookings to prove an email works would be an appalling trade.
   */
  let from = null;
  let to = null;
  let departure = null;
  outer: for (const date of dates.map((d) => d.value || d).slice(-6).reverse()) {
    for (const f of stations.slice(0, 6)) {
      for (const t of stations.slice(0, 12)) {
        if (f.id === t.id) continue;
        const r = await call(
          "GET",
          `/search/departures?fromStationId=${f.id}&toStationId=${t.id}&date=${date}`,
          { token: buyer }
        );
        for (const d of r.body?.departures || []) {
          if (d.availableCount < 2 || !d.fares?.length) continue;
          const existing = await Ticket.count({
            where: { status: TICKET_STATUS.VALID },
            include: [{ model: Booking, as: "booking", where: { tripId: d.tripId }, required: true }],
          });
          if (existing === 0) {
            from = f;
            to = t;
            departure = d;
            break outer;
          }
        }
      }
    }
  }

  if (!departure) {
    console.log("  SKIP  no empty departure to cancel safely — not touching one with tickets on it");
  } else {
    const journey = { tripId: departure.tripId, fromStationId: from.id, toStationId: to.id };

    const held = await call("POST", "/holds/auto", {
      token: buyer,
      body: { ...journey, count: 1, together: false },
    });
    const made = await call("POST", "/bookings", {
      token: buyer,
      body: {
        holdReference: held.body.hold.reference,
        passengers: [{ name: "Cancelled Passenger", nid: "1990555566677", dob: "1993-07-19" }],
        method: "wallet",
      },
    });
    check("a ticket is bought on an otherwise empty departure", made.status === 201,
      made.raw.slice(0, 200));

    // Last guard before the irreversible bit: still exactly one ticket, and ours.
    const onBoard = await Ticket.findAll({
      where: { status: TICKET_STATUS.VALID },
      include: [
        { model: Booking, as: "booking", where: { tripId: departure.tripId }, required: true },
      ],
    });
    const onlyOurs =
      onBoard.length === 1 && onBoard[0].booking.userId === buyerUser.id;
    check("the departure carries only this suite's own ticket", onlyOurs,
      `${onBoard.length} ticket(s) on board — refusing to cancel`);

    if (onlyOurs) {
      const before = sent.length;
      cancelledTripId = departure.tripId;

      const result = await refundService.issueForCancellation({
        tripId: departure.tripId,
        reason: "Track maintenance at Santahar",
        actorLabel: "notification suite",
      });
      check("the cancellation refunds the ticket", result.refunded === 1,
        `${result.refunded} refunded`);

      // Since 8B the message is not sent from here: it is queued as a job in
      // the same transaction as the refund, and the API's worker sends it —
      // retried if the mail server refuses, resumed after a restart. So look
      // for the job, wait for the worker to finish it, and read what it says.
      const ticketNumber = result.refunds[0]?.ticketNumber;
      const owed = (await Job.findAll({ where: { type: "notify.departure_cancelled" } }))
        .filter((j) => j.payload?.ticket === ticketNumber);
      check("a message is owed for it, written down with the refund", owed.length === 1,
        `${owed.length} message job(s)`);
      check("nothing is sent from inside the refund itself", sent.length === before,
        `${sent.length - before} sent directly`);

      let job = owed[0];
      for (let i = 0; job && i < 60 && !["succeeded", "failed"].includes(job.status); i++) {
        await pause(300);
        job = await Job.findByPk(job.id);
      }
      check("and the worker sends it", job?.status === "succeeded",
        `${job?.status} ${job?.lastError?.slice(0, 120) || ""}`);

      const m = job ? notificationService.departureCancelledMessage(job.payload) : null;
      check("the subject names the train",
        new RegExp(departure.train.name).test(m?.subject || ""), m?.subject);
      check("it says the fare is refunded in full", /in full/i.test(bodyOf(m)));
      check("it carries the reason given", /Track maintenance/.test(bodyOf(m)));
      check("it takes responsibility rather than blaming the passenger",
        /our decision/i.test(bodyOf(m)) && /did not change yours/i.test(bodyOf(m)));
      check("and points them at what to do next",
        /book another service/i.test(bodyOf(m)));
      check("nothing renders as a hole",
        !/undefined|null|NaN/.test(`${m?.subject} ${bodyOf(m)}`), bodyOf(m).slice(0, 220));
    }
  }

  /* ================================================================= *
   * A waitlist offer nobody answered
   * ================================================================= */

  console.log("\n== a lapsed waitlist offer tells them either way ==");

  // A stretch with room, filled by this suite's own blocks so a queue place is
  // legitimate. Every block is removed at the end, by reason.
  let qFrom = null;
  let qTo = null;
  let qDeparture = null;
  // The day searched for, not the day the train left its origin — they differ
  // for a mid-route overnight boarding, and looking up the wrong one silently
  // finds nothing, which would make a "sold out" check pass for the wrong reason.
  let qDate = null;
  queue: for (const date of dates.map((d) => d.value || d).slice(2)) {
    for (const f of stations.slice(0, 6)) {
      for (const t of stations.slice(0, 12)) {
        if (f.id === t.id) continue;
        const r = await call(
          "GET",
          `/search/departures?fromStationId=${f.id}&toStationId=${t.id}&date=${date}`,
          { token: queuer }
        );
        const usable = (r.body?.departures || []).find(
          (d) => d.availableCount >= 2 && d.fares?.length && d.tripId !== cancelledTripId
        );
        if (usable) {
          qFrom = f;
          qTo = t;
          qDeparture = usable;
          qDate = date;
          break queue;
        }
      }
    }
  }

  if (!qDeparture) {
    console.log("  SKIP  no departure with room to queue on");
  } else {
    // Leave exactly one seat free, so the sweep has something to offer.
    const seats = await TripSeat.findAll({
      where: { tripId: qDeparture.tripId },
      attributes: ["id"],
      raw: true,
    });
    const blockedSeats = [];
    for (const seat of seats) {
      try {
        await inventory.reserveSegments({
          tripId: qDeparture.tripId,
          seats: [{ tripSeatId: seat.id, fromStationId: qFrom.id, toStationId: qTo.id }],
          source: SEGMENT_SOURCE.BLOCK,
          reason: MINE,
        });
        blockedSeats.push(seat.id);
      } catch {
        /* already occupied by a real ticket or hold — fine */
      }
    }

    const soldOut = await call(
      "GET",
      `/search/departures?fromStationId=${qFrom.id}&toStationId=${qTo.id}` +
        `&date=${qDate}`,
      { token: queuer }
    );
    const nowFull = (soldOut.body?.departures || []).find((d) => d.tripId === qDeparture.tripId);
    check("the stretch is sold out, so a queue place is legitimate",
      nowFull?.availableCount === 0, `${nowFull?.availableCount} free`);

    const entry = await waitlistService.join({
      userId: queuerUser.id,
      tripId: qDeparture.tripId,
      fromStationId: qFrom.id,
      toStationId: qTo.id,
      count: 1,
      passengers: [{ name: "Lapsing Passenger", nid: "9876543210987", dob: "1990-05-05" }],
    });
    check("a queue place is taken", !!entry?.reference, JSON.stringify(entry)?.slice(0, 200));

    /*
     * Free one *whole* seat.
     *
     * Deleting an arbitrary number of block rows is not the same thing: a seat
     * is only sellable when every segment it needs over the stretch is free, so
     * a partial delete frees nothing the sweep can offer. Scoped to one seat id.
     */
    const freed = blockedSeats[0];
    check("there is a blocked seat to give back", !!freed, `${blockedSeats.length} blocked`);
    await SeatSegmentBooking.destroy({
      where: { tripSeatId: freed, source: SEGMENT_SOURCE.BLOCK, reason: MINE },
    });
    await waitlistService.sweep(qDeparture.tripId, { reason: "suite freed a seat" });

    const offered = await waitlistService.get(entry.reference, { userId: queuerUser.id });
    check("the seat is offered to them", offered.status === "offered", offered.status);

    if (offered.status === "offered") {
      // An hour ahead rather than an hour of waiting.
      const before = sent.length;
      const later = new Date(Date.now() + 3 * 60 * 60 * 1000);
      const result = await waitlistService.expireOffers({ now: later });
      check("the offer lapses", result.requeued + result.lapsed >= 1, JSON.stringify(result));

      await pause(1500);
      const messages = sent.slice(before);
      const mine = messages.find((m) => new RegExp(entry.reference).test(m?.subject || ""));
      check("a message went out about it", !!mine,
        (messages.map((m) => m.subject) || []).join(" | ").slice(0, 250));

      if (mine) {
        check("it says whether they kept their place or left the queue",
          /still in the queue|left the queue/i.test(mine.subject), mine.subject);
        check("it names the train", !!qDeparture.train?.name && new RegExp(qDeparture.train.name).test(bodyOf(mine)),
          bodyOf(mine).slice(0, 200));
        check("and how many offers they have missed", /Offers missed/i.test(bodyOf(mine)));
        check("nothing renders as a hole",
          !/undefined|null|NaN/.test(`${mine.subject} ${bodyOf(mine)}`), bodyOf(mine).slice(0, 220));
      }
    }

    // Leave nothing behind in the queue.
    const leftovers = await waitlistService.mine(queuerUser.id);
    for (const e of leftovers) {
      if (e.status === "waiting" || e.status === "offered") {
        await waitlistService.withdraw(e.reference, { userId: queuerUser.id }).catch(() => {});
      }
    }
  }

  /* ---------------- Put everything back ---------------- */

  const removed = await unblock();

  /*
   * Nothing to reinstate.
   *
   * `issueForCancellation` issues the refunds; setting the departure's status is
   * a separate step in `tripService`, which this suite deliberately never took.
   * So the departure is untouched and only our own ticket was refunded — which
   * is the whole reason for the guard above.
   */
  if (cancelledTripId) {
    const trip = await Trip.findByPk(cancelledTripId);
    console.log(`\n  departure ${cancelledTripId} left ${trip?.status} — only our ticket refunded`);
  }
  console.log(`  cleaned up ${removed} blocked segment row(s)`);

  emailService.sendMail = realSendMail;
  console.log(`\n${pass} passed, ${fail} failed`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error("\nsuite crashed:", err.message);
  try {
    await unblock();

    await sequelize.close();
  } catch {
    /* nothing more to do */
  }
  process.exit(1);
});
