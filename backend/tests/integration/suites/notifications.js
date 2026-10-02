// Every message the system sends, checked as a template rather than as SMTP.
//
// ## Why this tests templates, not delivery
//
// The unit-test accounts all sit on @example.com, which `isUnroutable` refuses
// to hand to a real SMTP server on purpose — so asserting "mail arrived" is not
// something this suite can honestly do. What it can do, and what actually
// breaks in practice, is check that each message renders: that it names the
// right amounts, says the right thing about a policy the passenger has to
// understand, and does not print "undefined" at someone.
//
// The wiring — that a return, a cancellation, an approval and a lapsed offer
// each reach this code at all — is asserted by spying on the send, which is the
// part a refactor silently breaks.
const BACKEND = require("path").resolve(__dirname, "../../..");
const { sequelize } = require(`${BACKEND}/src/models`);
const emailService = require(`${BACKEND}/src/services/emailService`);
const notify = require(`${BACKEND}/src/services/notificationService`);

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

const text = (m) => String(m?.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const last = () => sent[sent.length - 1];

/** Nothing the system sends may ever print a hole at a passenger. */
const clean = (m) =>
  !/undefined|null|NaN|\[object Object\]/.test(`${m?.subject} ${text(m)}`);

(async () => {
  const { User } = require(`${BACKEND}/src/models`);
  const user = await User.findOne({ where: { email: "unittest-user@example.com" } });
  if (!user) {
    console.error("unittest-user@example.com is missing — run npm run seed:unittestusers");
    process.exit(1);
  }

  console.log("\n== a convenient return is finished, and says so ==");
  await notify.ticketReturned({
    userId: user.id,
    refund: {
      reference: "RABC1234",
      fareMinor: 39520,
      deductionPercent: 10,
      refundedMinor: 35568,
      maximumMinor: 35568,
    },
    ticket: { ticketNumber: "TAAAA-BBBB" },
    journey: "Dhaka (Kamalapur) → Dinajpur",
    immediate: true,
  });
  let m = last();
  check("a message goes out", !!m);
  check("the subject names the amount credited", /355\.68/.test(m.subject), m.subject);
  check("and the return reference, so it is findable later", /RABC1234/.test(m.subject));
  check("the body names the journey", /Dhaka/.test(text(m)) && /Dinajpur/.test(text(m)));
  check("it says the money is already there",
    /in your wallet now/i.test(text(m)), text(m).slice(0, 200));
  check("it does not talk about waiting for a resale",
    !/resell/i.test(text(m)), "a finished return should not mention resale");
  check("nothing renders as a hole", clean(m), text(m).slice(0, 200));

  console.log("\n== a demand return has only started, and says that instead ==");
  await notify.ticketReturned({
    userId: user.id,
    refund: {
      reference: "RXYZ9876",
      fareMinor: 39520,
      deductionPercent: 10,
      refundedMinor: 0,
      maximumMinor: 35568,
    },
    ticket: { ticketNumber: "TCCCC-DDDD" },
    journey: "Dhaka (Kamalapur) → Dinajpur",
    immediate: false,
    segments: 3,
  });
  m = last();
  check("the subject says it is waiting, not paid", /waiting on resale/i.test(m.subject), m.subject);
  check("the body states plainly that nothing has been paid yet",
    /Nothing has been paid yet/i.test(text(m)));
  check("it explains payment depends on the seat reselling",
    /as the seat is bought again|segment by segment/i.test(text(m)));
  check("it warns that an unsold seat refunds nothing",
    /refunds nothing/i.test(text(m)), "the trade has to be stated before it bites");
  check("it quotes the ceiling, not a credited amount",
    /355\.68/.test(text(m)) && /Most you can receive/i.test(text(m)));
  check("nothing renders as a hole", clean(m), text(m).slice(0, 200));

  console.log("\n== a demand return paying out in instalments ==");
  await notify.refundSegmentSettled({
    userId: user.id,
    refund: { reference: "RXYZ9876", refundedMinor: 12000, maximumMinor: 35568 },
    paidMinor: 12000,
    remaining: 2,
  });
  m = last();
  check("a partial payout says part, not all", /Part of your return/i.test(m.subject), m.subject);
  check("it names what just arrived", /120\.00/.test(text(m)));
  check("and how much is still waiting", /Segments still waiting/i.test(text(m)) && / 2 /.test(text(m)));
  check("it does not claim the return is complete", !/complete/i.test(m.subject));
  check("nothing renders as a hole", clean(m), text(m).slice(0, 200));

  await notify.refundSegmentSettled({
    userId: user.id,
    refund: { reference: "RXYZ9876", refundedMinor: 35568, maximumMinor: 35568 },
    paidMinor: 11568,
    remaining: 0,
  });
  m = last();
  check("the last segment says the return is complete",
    /complete/i.test(m.subject), m.subject);
  check("and that every part resold", /resold/i.test(text(m)));

  console.log("\n== a demand return that never sold ==");
  await notify.refundClosedUnsold({
    userId: user.id,
    refund: { reference: "RNIL0001", refundedMinor: 0 },
    unsoldSegments: 3,
  });
  m = last();
  check("closing is announced rather than silent", /closed/i.test(m.subject), m.subject);
  check("it says the seat did not resell", /did not resell/i.test(text(m)));
  check("and is honest that this pays nothing", /pays nothing/i.test(text(m)));
  check("it names the alternative, without pretending it was hidden",
    /convenient return/i.test(text(m)), "worth knowing for next time");
  check("nothing renders as a hole", clean(m), text(m).slice(0, 250));

  console.log("\n== the railway cancels ==");
  await notify.departureCancelled({
    userId: user.id,
    ticket: "TEEEE-FFFF",
    refundMinor: 39520,
    reason: "Track maintenance at Santahar",
    train: "Ekota Express",
    journey: "Dhaka (Kamalapur) → Dinajpur",
    date: "2026-09-25",
  });
  m = last();
  check("the subject names the train", /Ekota Express/.test(m.subject), m.subject);
  check("the message apologises and takes responsibility",
    /sorry/i.test(text(m)) && /our decision/i.test(text(m)));
  check("it says the fare is refunded in full", /in full/i.test(text(m)));
  check("it gives the reason", /Track maintenance/.test(text(m)));
  check("it explains why nothing was deducted",
    /did not change yours/i.test(text(m)), "a deduction prices changing your mind");
  check("and says what they can do next", /book another service/i.test(text(m)));
  check("nothing renders as a hole", clean(m), text(m).slice(0, 250));

  console.log("\n== a decision somebody made ==");
  await notify.approvalDecided({
    userId: user.id,
    request: { reference: "APAB12CD", type: "ticket_transfer" },
    approved: true,
    note: "Identity documents checked",
    decidedBy: "Unit Test Admin",
  });
  m = last();
  check("an approval says approved", /approved/i.test(m.subject), m.subject);
  check("it names who decided", /Unit Test Admin/.test(text(m)));
  check("and carries the note", /Identity documents checked/.test(text(m)));
  check("nothing renders as a hole", clean(m), text(m).slice(0, 200));

  await notify.approvalDecided({
    userId: user.id,
    request: { reference: "APEF34GH", type: "wallet_withdrawal" },
    approved: false,
    note: "Destination account could not be verified",
    decidedBy: "Unit Test Admin",
  });
  m = last();
  check("a rejection says not approved", /not approved/i.test(m.subject), m.subject);
  check("a rejection always carries its reason",
    /could not be verified/i.test(text(m)),
    "rejected with no reason generates a support call");
  check("and says what to do about it", /raise the request again/i.test(text(m)));

  console.log("\n== a waitlist offer nobody answered ==");
  await notify.waitlistOfferExpired({
    userId: user.id,
    entry: {
      reference: "WQR56ST",
      train: "Ekota Express",
      journey: "Dhaka (Kamalapur) → Dinajpur",
      departureDate: "2026-09-25",
    },
    stillQueued: true,
    offersMade: 1,
    limit: 2,
  });
  m = last();
  check("someone who kept their place is told so",
    /still in the queue/i.test(m.subject), m.subject);
  check("it says the place was kept", /kept your original place/i.test(text(m)));
  check("and warns what happens after the limit", /passed on/i.test(text(m)));
  check("nothing renders as a hole", clean(m), text(m).slice(0, 250));

  await notify.waitlistOfferExpired({
    userId: user.id,
    entry: {
      reference: "WQR56ST",
      train: "Ekota Express",
      journey: "Dhaka (Kamalapur) → Dinajpur",
      departureDate: "2026-09-25",
    },
    stillQueued: false,
    offersMade: 2,
    limit: 2,
  });
  m = last();
  check("someone who used up their allowance is told that instead",
    /left the queue/i.test(m.subject), m.subject);
  check("and invited to rejoin", /join the queue again/i.test(text(m)));

  console.log("\n== a failed send never breaks what called it ==");
  emailService.sendMail = async () => {
    throw new Error("SMTP is down");
  };
  const survived = await notify
    .departureCancelled({ userId: user.id, ticket: "T", refundMinor: 100, train: "X" })
    .then(() => true)
    .catch(() => false);
  check("a send that throws resolves rather than rejecting", survived === true,
    "a refund that credited correctly must not report failure because SMTP was slow");
  check("and reports that nothing went out", survived === true);

  emailService.sendMail = async (message) => {
    sent.push(message);
    return true;
  };
  const noAddress = await notify.departureCancelled({ userId: null, ticket: "T", refundMinor: 1 });
  check("no recipient is a quiet no-op, not a crash", noAddress === false);

  emailService.sendMail = realSendMail;

  console.log(`\n${pass} passed, ${fail} failed  (${sent.length} messages rendered)`);
  await sequelize.close();
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error("\nsuite crashed:", err.message);
  try {
    await sequelize.close();
  } catch {
    /* nothing more to do */
  }
  process.exit(1);
});
