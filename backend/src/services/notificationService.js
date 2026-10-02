const { User } = require("../models");
const email = require("./emailService");

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

/* ---------------- The look every message shares ---------------- */

// Built from the shared email layout (src/emails/layout.js), so every message
// — these, the codes, the tickets — looks like it came from the same place.
const ui = require("../emails/layout");

const reference = (label, value) => ui.trusted(`${ui.esc(label)} ${ui.esc(ui.strong(value))}`);

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
  const subject = immediate
    ? `Ticket returned — ${ui.taka(refund.refundedMinor)} credited (${refund.reference})`
    : `Ticket returned — waiting on resale (${refund.reference})`;

  const html = immediate
    ? ui.page({
        subject,
        preheader: `${ui.taka(refund.refundedMinor)} is in your wallet now.`,
        eyebrow: "Ticket returned",
        tone: "success",
        title: "Your return is paid",
        intro: reference("Return reference", refund.reference),
        body:
          ui.amount({
            label: "Credited to your wallet",
            value: ui.taka(refund.refundedMinor),
            caption: "The money is in your wallet now and can be spent or withdrawn.",
            tone: "success",
          }) +
          ui.details([
            ["Ticket", ticket?.ticketNumber],
            ["Journey", journey],
            ["Fare paid", ui.taka(refund.fareMinor)],
            ["Deduction", `${refund.deductionPercent}%`],
          ]) +
          ui.button("See your returns", ui.appUrl("/dashboard/refunds"), { tone: "success" }),
      })
    : ui.page({
        subject,
        preheader: "Nothing is paid until the seat sells again — here is how it works.",
        eyebrow: "Ticket returned",
        tone: "brand",
        title: "Your return is open",
        intro: reference("Return reference", refund.reference),
        body:
          ui.amount({
            label: "Most you can receive",
            value: ui.taka(refund.maximumMinor),
            caption: "Paid stretch by stretch, as the seat is bought again.",
            tone: "brand",
          }) +
          ui.details([
            ["Ticket", ticket?.ticketNumber],
            ["Journey", journey],
            ["Fare paid", ui.taka(refund.fareMinor)],
            ["Segments waiting to resell", segments],
          ]) +
          ui.callout(
            "Nothing has been paid yet. A demand-based return pays only as the seat is bought " +
              "again, segment by segment — you will be emailed each time part of it sells. " +
              "Anything still unsold when the train leaves refunds nothing, which is the trade " +
              "you took for the larger amount.",
            { tone: "warning", title: "How a demand-based return pays" }
          ) +
          ui.button("Follow this return", ui.appUrl("/dashboard/refunds")),
      });

  return deliver(userId, { subject, html });
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
  const subject = finished
    ? `Return complete — ${ui.taka(paidMinor)} credited (${refund.reference})`
    : `Part of your return has paid — ${ui.taka(paidMinor)} (${refund.reference})`;

  return deliver(userId, {
    subject,
    html: ui.page({
      subject,
      preheader: `${ui.taka(paidMinor)} credited to your wallet.`,
      eyebrow: finished ? "Return complete" : "Return paying out",
      tone: "success",
      title: finished ? "Your return is complete" : "Your seat sold — part of your return is paid",
      intro: reference("Return reference", refund.reference),
      body:
        ui.amount({
          label: "Credited now",
          value: ui.taka(paidMinor),
          caption: "The money is in your wallet now and can be spent or withdrawn.",
          tone: "success",
        }) +
        ui.details([
          ["Paid on this return so far", ui.taka(refund.refundedMinor)],
          ["Most you can receive", ui.taka(refund.maximumMinor)],
          ["Segments still waiting", finished ? "None" : remaining],
        ]) +
        (finished
          ? ui.callout("Every part of the seat resold, so this return is now closed.", { tone: "success" })
          : ui.callout("The rest of the seat has not been bought yet. You will be emailed again if it is.", {
              tone: "brand",
            })) +
        ui.button("Open your wallet", ui.appUrl("/dashboard/wallet"), { tone: "success" }),
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
  const subject = `Return closed — ${refund.reference}`;
  return deliver(userId, {
    subject,
    html: ui.page({
      subject,
      preheader: "The train has left, so this return will not pay any further.",
      eyebrow: "Return closed",
      tone: "neutral",
      title: "Your return has closed",
      intro: reference("Return reference", refund.reference),
      body:
        ui.details([
          ["Paid to your wallet", ui.taka(refund.refundedMinor)],
          ["Segments that did not resell", unsoldSegments],
        ]) +
        ui.callout(
          refund.refundedMinor > 0
            ? "The train has now left, so the remaining segments can no longer sell and this " +
                "return will not pay any further."
            : "The seat did not resell before the train left, so this demand-based return pays " +
                "nothing. A convenient return would have paid a smaller amount regardless — " +
                "worth knowing for next time.",
          { tone: "neutral" }
        ) +
        ui.button("See your returns", ui.appUrl("/dashboard/refunds"), { tone: "neutral" }),
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
  const subject = `Service cancelled — ${train || "your train"}${date ? `, ${date}` : ""}`;
  const [from, to] = String(journey || "").split(/\s*→\s*/);
  return {
    subject,
    html: ui.page({
      subject,
      preheader: `Your fare of ${ui.taka(refundMinor)} is back in your wallet, in full.`,
      eyebrow: "Service cancelled",
      tone: "danger",
      title: "Your train has been cancelled",
      intro: "We are sorry. This was our decision, not yours, so your fare is refunded in full.",
      body:
        (journey ? ui.journey({ from: from || journey, to: to || "", train, date }) : "") +
        ui.amount({
          label: "Refunded in full",
          value: ui.taka(refundMinor),
          caption: "Nothing has been deducted.",
          tone: "success",
        }) +
        ui.details([
          ["Ticket", ticket],
          ["Reason", reason],
          ...(journey ? [] : [["Train", train], ["Date", date]]),
        ]) +
        ui.callout(
          "A deduction prices the cost of someone changing their mind, and you did not change yours.",
          { tone: "success", title: "Why nothing was deducted" }
        ) +
        ui.paragraph(
          "The money is in your wallet now — you can book another service with it straight away, or withdraw it."
        ) +
        ui.button("Book another service", ui.appUrl("/dashboard/book")),
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
  const subject = `${label} ${approved ? "approved" : "not approved"} — ${request.reference}`;

  return deliver(userId, {
    subject,
    html: ui.page({
      subject,
      preheader: decisionNote || (approved ? "Approved." : "Not approved."),
      eyebrow: approved ? "Request approved" : "Request not approved",
      tone: approved ? "success" : "warning",
      title: approved ? titles.approved : titles.rejected,
      intro: reference("Reference", request.reference),
      body:
        ui.details([
          ["Request", label.charAt(0).toUpperCase() + label.slice(1)],
          ["Decision", approved ? "Approved" : "Not approved"],
          ["Decided by", decidedBy || null],
        ]) +
        (decisionNote ? ui.callout(decisionNote, { tone: approved ? "success" : "warning", title: "Note from the reviewer" }) : "") +
        (approved
          ? ""
          : ui.paragraph("If this was not what you expected, you can raise the request again with more detail.")) +
        ui.button("See your requests", ui.appUrl("/dashboard/requests"), { tone: approved ? "success" : "brand" }),
    }),
  });
}

/* ---------------- Access ---------------- */

/** "super_admin" → "Super Admin"; the default role reads as what it is. */
const roleName = (name) =>
  name === "user"
    ? "Passenger"
    : String(name || "")
        .split(/[_\s-]+/)
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(" ");

/**
 * Someone changed what this account can do.
 *
 * Sent to the account itself, every time. A role is the key to money and other
 * people's data; being granted one unexpectedly is worth knowing about, and
 * losing one without being told is how someone finds a screen gone mid-shift.
 * So it says what changed, who changed it, and what the account can do now —
 * and how to raise it if it was not expected.
 */
function rolesChangedMessage({ granted = [], revoked = [], changedBy, abilities = [], everything = false }) {
  const subject =
    granted.length && !revoked.length
      ? `You have been given the ${granted.map((r) => roleName(r.name)).join(" and ")} role${granted.length === 1 ? "" : "s"}`
      : "Your access to Seat Planner has changed";

  const section = (title, roles, toneName, prefix) =>
    roles.length
      ? ui.sectionTitle(title) +
        ui.chips(roles.map((r) => roleName(r.name)), { tone: toneName, prefix }) +
        roles
          .filter((r) => r.description)
          .map((r) => ui.paragraph(ui.trusted(`${ui.esc(ui.strong(roleName(r.name)))} — ${ui.esc(r.description)}`), { size: 14 }))
          .join("")
      : "";

  return {
    subject,
    html: ui.page({
      subject,
      preheader: [
        granted.length ? `Added: ${granted.map((r) => roleName(r.name)).join(", ")}.` : "",
        revoked.length ? `Removed: ${revoked.map((r) => roleName(r.name)).join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      eyebrow: "Your account",
      tone: "brand",
      title: "Your access has changed",
      intro: changedBy
        ? ui.trusted(`${ui.esc(ui.strong(changedBy))} changed the roles on your account. It takes effect straight away.`)
        : "The roles on your account were changed. It takes effect straight away.",
      body:
        section("Added", granted, "success", "+ ") +
        section("Removed", revoked, "danger", "− ") +
        ui.sectionTitle("What you can do now") +
        (everything
          ? ui.callout("Everything — this account is a super admin.", { tone: "brand" })
          : abilities.length
            ? ui.details(abilities.map(({ group, labels }) => [group, labels.join(", ")]))
            : ui.paragraph("Nothing beyond signing in.", { muted: true })) +
        ui.button("Open Seat Planner", ui.appUrl("/dashboard")) +
        ui.callout(
          "If you did not expect this, tell an administrator. Every change to someone's roles is recorded, " +
            "with who made it and when.",
          { tone: "warning", title: "Not expecting this?" }
        ),
    }),
  };
}

async function rolesChanged({ userId, ...details }) {
  return deliver(userId, rolesChangedMessage(details));
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
  const subject = "Your account cannot book at the moment";
  return deliver(userId, {
    subject,
    html: ui.page({
      subject,
      preheader: "Existing tickets are unaffected — you can still travel on anything already booked.",
      eyebrow: "Your account",
      tone: "warning",
      title: "Your account is on hold",
      intro: "Existing tickets are unaffected. You can still travel on anything already booked.",
      body:
        ui.details([
          ["What happened", detail],
          ["Placed by", automatic ? "An automatic check" : "A member of staff"],
        ]) +
        ui.callout(
          automatic
            ? "This was placed by an automatic check rather than a person. If it looks wrong, it " +
                "may well be — reply to this message and someone will review it."
            : "If you think this is a mistake, reply to this message and it will be reviewed.",
          { tone: "warning" }
        ) +
        ui.paragraph(
          "A hold can always be lifted. It stops new bookings; it does not cancel anything you have already paid for.",
          { muted: true, size: 14 }
        ) +
        ui.button("See your bookings", ui.appUrl("/dashboard/bookings")),
    }),
  });
}

/** And it has been lifted. */
async function accountReleased({ userId, note: reason }) {
  const subject = "Your account can book again";
  return deliver(userId, {
    subject,
    html: ui.page({
      subject,
      preheader: "The hold on your account has been lifted.",
      eyebrow: "Your account",
      tone: "success",
      title: "The hold on your account has been lifted",
      intro: "You can book as normal again. Sorry for the interruption.",
      body:
        (reason ? ui.callout(reason, { tone: "success", title: "Reason given" }) : "") +
        ui.button("Book a ticket", ui.appUrl("/dashboard/book"), { tone: "success" }),
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
  const subject = stillQueued
    ? `You missed a seat — still in the queue (${entry.reference})`
    : `You have left the queue (${entry.reference})`;
  const [from, to] = String(entry.journey || "").split(/\s*→\s*/);

  return deliver(userId, {
    subject,
    html: ui.page({
      subject,
      preheader: stillQueued ? "You kept your place for the next seat returned." : "Your allowance of offers is used up.",
      eyebrow: "Waitlist",
      tone: stillQueued ? "warning" : "neutral",
      title: stillQueued ? "That seat went back on sale" : "You have left the queue",
      intro: reference("Queue reference", entry.reference),
      body:
        (entry.journey
          ? ui.journey({ from: from || entry.journey, to: to || "", train: entry.train, date: entry.departureDate })
          : "") +
        ui.details([["Offers missed", `${offersMade} of ${limit}`]]) +
        ui.callout(
          stillQueued
            ? "You kept your original place in the queue, so you are still in line for the next " +
                "seat returned. Each unanswered offer holds a seat out of sale for everyone, " +
                `so after ${limit} the place is passed on.`
            : "The offer was not answered in time, and with it your allowance is used up. You " +
                "are welcome to join the queue again.",
          { tone: stillQueued ? "warning" : "neutral" }
        ) +
        ui.button(stillQueued ? "See your queue" : "Find a seat", ui.appUrl(stillQueued ? "/dashboard/bookings" : "/dashboard/book")),
    }),
  });
}

module.exports = {
  rolesChanged,
  rolesChangedMessage,
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
