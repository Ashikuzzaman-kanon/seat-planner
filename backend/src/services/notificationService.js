const { User } = require("../models");
const email = require("./emailService");
const money = require("../utils/money");

/**
 * Telling passengers what happened to their money and their seats.
 *
 * ## Why this is its own module
 *
 * Until now the only mail the system sent was a booking confirmation, sent from
 * inside the booking service. That was fine for one message. It stops being
 * fine at six, because every caller then has to remember the same three things:
 * look up an address, never let a send failure break the operation, and write
 * HTML that looks like the rest. Putting them here means a caller writes one
 * line and cannot get those wrong.
 *
 * It is also the seam §16.1 reserves for notification channels. Adding SMS,
 * push or in-app later means changing `deliver` and nothing else — the callers
 * say *what happened*, not *how to tell someone*.
 *
 * ## Nothing here can break what called it
 *
 * Every send is caught and logged. A refund that credited a wallet correctly
 * must not report failure because an SMTP server was slow, and a passenger who
 * misses an email can still see everything in the app. Notification is a
 * courtesy laid on top of state that is already durable.
 *
 * ## Everything here is called after the transaction commits
 *
 * A mail sent from inside a transaction can describe a payment that then rolls
 * back. Callers collect what to say, commit, and then say it.
 */

/* ---------------- The shell every message shares ---------------- */

const BRAND = "#1d4ed8";

function shell({ title, accent = BRAND, lead, body = "", footer }) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#1f2937;max-width:560px;">
      <h2 style="color:${accent};margin:0 0 4px;">${title}</h2>
      ${lead ? `<p style="margin:0 0 20px;color:#6b7280;">${lead}</p>` : ""}
      ${body}
      ${
        footer
          ? `<p style="color:#6b7280;font-size:13px;margin:16px 0 0;">${footer}</p>`
          : ""
      }
    </div>`;
}

const rows = (pairs) => `
  <table style="border-collapse:collapse;margin-bottom:20px;">
    ${pairs
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(
        ([label, value]) => `
      <tr>
        <td style="padding:6px 16px 6px 0;color:#6b7280;font-size:13px;">${label}</td>
        <td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;">${value}</td>
      </tr>`
      )
      .join("")}
  </table>`;

const note = (text, colour = "#b45309") =>
  `<p style="margin:0 0 16px;color:${colour};font-size:14px;">${text}</p>`;

/**
 * One way out.
 *
 * Takes a user id rather than an address so no caller has to do the lookup, and
 * swallows everything: see the note above about why a failed send must never
 * become a failed operation.
 */
/**
 * Send one message to one account.
 *
 * Ordinarily a failure is logged and swallowed — a message is a courtesy laid
 * on top of state that is already durable, and must never fail the operation
 * that caused it. `strict` is for a caller that *wants* to know: a queued job
 * sending the message, which retries it on failure instead of losing it.
 * Having no email address is not a failure in either mode; there is nothing to
 * retry.
 */
async function deliver(userId, { subject, html }, { strict = false } = {}) {
  try {
    if (!userId) return false;
    const user = await User.findByPk(userId, { attributes: ["email"] });
    if (!user?.email) return false;
    await email.sendMail({ to: user.email, subject, html });
    return true;
  } catch (err) {
    console.error(`[notify] could not send "${subject}" to user ${userId}: ${err.message}`);
    if (strict) throw err;
    return false;
  }
}

/* ---------------- Returns ---------------- */

/**
 * A passenger gave a ticket back.
 *
 * The two policies need genuinely different messages, not one message with a
 * different number in it. A convenient return is finished — money is in the
 * wallet and there is nothing to wait for. A demand return has only *started*:
 * nothing has been paid, payment depends on the seat reselling, and if it does
 * not resell the answer is nothing. Saying that plainly now is the difference
 * between a passenger who understands the deal they chose and one who thinks
 * they have been robbed in a fortnight.
 */
async function ticketReturned({ userId, refund, ticket, journey, immediate, segments = 0 }) {

  const body = immediate
    ? rows([
        ["Ticket", ticket?.ticketNumber],
        ["Journey", journey],
        ["Fare paid", money.format(refund.fareMinor)],
        ["Deduction", `${refund.deductionPercent}%`],
        ["Credited to your wallet", money.format(refund.refundedMinor)],
      ]) + note("The money is in your wallet now and can be spent or withdrawn.", "#15803d")
    : rows([
        ["Ticket", ticket?.ticketNumber],
        ["Journey", journey],
        ["Fare paid", money.format(refund.fareMinor)],
        ["Most you can receive", money.format(refund.maximumMinor)],
        ["Segments waiting to resell", segments],
      ]) +
      note(
        "Nothing has been paid yet. A demand-based return pays only as the seat is bought " +
          "again, segment by segment — you will be emailed each time part of it sells. " +
          "Anything still unsold when the train leaves refunds nothing, which is the trade " +
          "you took for the larger amount."
      );

  return deliver(userId, {
    subject: immediate
      ? `Ticket returned — ${money.format(refund.refundedMinor)} credited (${refund.reference})`
      : `Ticket returned — waiting on resale (${refund.reference})`,
    html: shell({
      title: immediate ? "Your return is paid" : "Your return is open",
      accent: immediate ? "#15803d" : BRAND,
      lead: `Return reference <strong style="color:#111827;">${refund.reference}</strong>`,
      body,
      footer: "You can follow this return at any time under Returns in your account.",
    }),
  });
}

/**
 * Part of a demand-based return just sold.
 *
 * This is the message the whole policy depends on. A demand return can pay in
 * instalments over days as separate stretches of the seat find buyers, and
 * without this a passenger would have to keep opening the wallet page to
 * discover money had arrived. Being paid without being told is barely better
 * than not being paid.
 */
async function refundSegmentSettled({ userId, refund, paidMinor, remaining }) {
  const finished = remaining === 0;

  return deliver(userId, {
    subject: finished
      ? `Return complete — ${money.format(paidMinor)} credited (${refund.reference})`
      : `Part of your return has paid — ${money.format(paidMinor)} (${refund.reference})`,
    html: shell({
      title: finished ? "Your return is complete" : "Your seat sold — part of your return is paid",
      accent: "#15803d",
      lead: `Return reference <strong style="color:#111827;">${refund.reference}</strong>`,
      body:
        rows([
          ["Credited now", money.format(paidMinor)],
          ["Paid on this return so far", money.format(refund.refundedMinor)],
          ["Most you can receive", money.format(refund.maximumMinor)],
          ["Segments still waiting", finished ? "None" : remaining],
        ]) +
        (finished
          ? note("Every part of the seat resold, so this return is now closed.", "#15803d")
          : note(
              "The rest of the seat has not been bought yet. You will be emailed again if it is."
            )),
      footer: "The money is in your wallet now and can be spent or withdrawn.",
    }),
  });
}

/**
 * The train left and part of a demand return never sold.
 *
 * Closing a refund silently would leave someone waiting indefinitely for money
 * that is now never coming. Saying so is not a pleasant message, but an absent
 * one is worse.
 */
async function refundClosedUnsold({ userId, refund, unsoldSegments }) {
  return deliver(userId, {
    subject: `Return closed — ${refund.reference}`,
    html: shell({
      title: "Your return has closed",
      accent: "#6b7280",
      lead: `Return reference <strong style="color:#111827;">${refund.reference}</strong>`,
      body:
        rows([
          ["Paid to your wallet", money.format(refund.refundedMinor)],
          ["Segments that did not resell", unsoldSegments],
        ]) +
        note(
          refund.refundedMinor > 0
            ? "The train has now left, so the remaining segments can no longer sell and this " +
                "return will not pay any further."
            : "The seat did not resell before the train left, so this demand-based return pays " +
                "nothing. A convenient return would have paid a smaller amount regardless — " +
                "worth knowing for next time."
        ),
    }),
  });
}

/* ---------------- When the railway is the one who cancels ---------------- */

/**
 * We cancelled the train.
 *
 * Distinct from a return in every way that matters to the person reading it:
 * they did not choose this, nothing is deducted, and the money is already in
 * their wallet. It also has to say what they should do next, because unlike a
 * return there is a journey they still need to make.
 *
 * The words are rendered separately from the sending. A cancellation's
 * messages are sent by queued jobs, possibly in another
 * process and minutes later. Rendering on its own lets the job send exactly
 * this, and lets a test read what a passenger would be told without having to
 * be the process that happened to send it.
 */
function departureCancelledMessage({ ticket, refundMinor, reason, train, journey, date }) {
  return {
    subject: `Service cancelled — ${train || "your train"}${date ? `, ${date}` : ""}`,
    html: shell({
      title: "Your train has been cancelled",
      accent: "#b91c1c",
      lead: "We are sorry. This was our decision, not yours, so your fare is refunded in full.",
      body:
        rows([
          ["Train", train],
          ["Journey", journey],
          ["Date", date],
          ["Ticket", ticket],
          ["Refunded in full", money.format(refundMinor)],
          ["Reason", reason],
        ]) +
        note(
          "Nothing has been deducted. A deduction prices the cost of someone changing their " +
            "mind, and you did not change yours.",
          "#15803d"
        ),
      footer:
        "The money is in your wallet now — you can book another service with it straight away, " +
        "or withdraw it.",
    }),
  };
}

async function departureCancelled(details, options) {
  return deliver(details.userId, departureCancelledMessage(details), options);
}

/* ---------------- Decisions a person made ---------------- */

const DECISION_TITLES = {
  ticket_transfer: {
    approved: "Your ticket transfer was approved",
    rejected: "Your ticket transfer was not approved",
  },
  wallet_withdrawal: {
    approved: "Your withdrawal was approved",
    rejected: "Your withdrawal was not approved",
  },
};

/**
 * Somebody decided on a request that was waiting.
 *
 * One message for every approval type, because they are one mechanism (§16.1) —
 * the fourth type will get this for free. The decision note is included
 * whenever there is one: "rejected" without a reason is the kind of message
 * that generates a support call.
 */
async function approvalDecided({ userId, request, approved, note: decisionNote, decidedBy }) {
  const titles = DECISION_TITLES[request.type] || {
    approved: "Your request was approved",
    rejected: "Your request was not approved",
  };
  const label = request.type.replace(/_/g, " ");

  return deliver(userId, {
    subject: `${label} ${approved ? "approved" : "not approved"} — ${request.reference}`,
    html: shell({
      title: approved ? titles.approved : titles.rejected,
      accent: approved ? "#15803d" : "#b45309",
      lead: `Reference <strong style="color:#111827;">${request.reference}</strong>`,
      body:
        rows([
          ["Request", label],
          ["Decision", approved ? "Approved" : "Not approved"],
          ["Decided by", decidedBy || null],
          ["Note", decisionNote || null],
        ]) +
        (approved
          ? ""
          : note(
              "If this was not what you expected, you can raise the request again with more " +
                "detail."
            )),
    }),
  });
}

/* ---------------- Standing ---------------- */

/**
 * An account has been stopped from buying.
 *
 * The hardest message here to write, and the one most worth writing carefully.
 * Somebody is being told they cannot use a service they have paid into, and a
 * proportion of the people receiving it will not deserve it — a checker can be
 * mistaken, and an automatic hold is arithmetic that has never met them.
 *
 * So it says what happened, that it can be lifted, and how to ask. What it does
 * not do is accuse: the detail explains the decision without asserting that the
 * person is a fraud, because at the moment this is sent nobody has established
 * that.
 */
async function accountHeld({ userId, detail, automatic }) {
  return deliver(userId, {
    subject: "Your account cannot book at the moment",
    html: shell({
      title: "Your account is on hold",
      accent: "#b45309",
      lead: "Existing tickets are unaffected. You can still travel on anything already booked.",
      body:
        rows([
          ["What happened", detail],
          ["Placed by", automatic ? "An automatic check" : "A member of staff"],
        ]) +
        (automatic
          ? note(
              "This was placed by an automatic check rather than a person. If it looks wrong, it " +
                "may well be — reply to this message and someone will review it."
            )
          : note("If you think this is a mistake, reply to this message and it will be reviewed.")),
      footer:
        "A hold can always be lifted. It stops new bookings; it does not cancel anything you " +
        "have already paid for.",
    }),
  });
}

/** And it has been lifted. */
async function accountReleased({ userId, note: reason }) {
  return deliver(userId, {
    subject: "Your account can book again",
    html: shell({
      title: "The hold on your account has been lifted",
      accent: "#15803d",
      lead: "You can book as normal again.",
      body: rows([["Reason given", reason]]),
      footer: "Sorry for the interruption.",
    }),
  });
}

/* ---------------- The waitlist ---------------- */

/**
 * A seat was offered and nobody answered.
 *
 * Worth sending because the passenger may never have seen the offer at all —
 * and because the consequence differs: either they kept their place, or they
 * have now used up their allowance and left the queue. Telling them only in the
 * first case would mean the people who most need to know hear nothing.
 */
async function waitlistOfferExpired({ userId, entry, stillQueued, offersMade, limit }) {
  return deliver(userId, {
    subject: stillQueued
      ? `You missed a seat — still in the queue (${entry.reference})`
      : `You have left the queue (${entry.reference})`,
    html: shell({
      title: stillQueued ? "That seat went back on sale" : "You have left the queue",
      accent: stillQueued ? "#b45309" : "#6b7280",
      lead: `Queue reference <strong style="color:#111827;">${entry.reference}</strong>`,
      body:
        rows([
          ["Train", entry.train],
          ["Journey", entry.journey],
          ["Date", entry.departureDate],
          ["Offers missed", `${offersMade} of ${limit}`],
        ]) +
        (stillQueued
          ? note(
              "You kept your original place in the queue, so you are still in line for the next " +
                "seat returned. Each unanswered offer holds a seat out of sale for everyone, " +
                `so after ${limit} the place is passed on.`
            )
          : note(
              "The offer was not answered in time, and with it your allowance is used up. You " +
                "are welcome to join the queue again."
            )),
    }),
  });
}

module.exports = {
  ticketReturned,
  accountHeld,
  accountReleased,
  refundSegmentSettled,
  refundClosedUnsold,
  departureCancelled,
  departureCancelledMessage,
  approvalDecided,
  waitlistOfferExpired,
  // Exported so a new message can be added without reaching past the shell.
  deliver,
};
