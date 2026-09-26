import Link from "next/link";
import "./privacy.css";

/*
 * The privacy policy.
 *
 * Public, and plain: what the service keeps, why, who else handles it, and
 * how to have it removed. Google asks for a link to one before an app that
 * sends email through the Gmail API can leave testing, and anyone creating an
 * account deserves to be able to read it first.
 *
 * Kept to what the code actually does. If the service starts keeping
 * something new, this page changes with it.
 */
export const metadata = {
  title: "Privacy — Seat Planner",
  description: "What Seat Planner keeps about you, why, and how to have it removed.",
};

const UPDATED = "27 September 2026";

export default function PrivacyPage() {
  return (
    <main className="legal">
      <article className="legal__doc">
        <Link href="/login" className="legal__back">
          <i className="pi pi-arrow-left" aria-hidden="true" /> Seat Planner
        </Link>

        <h1>Privacy</h1>
        <p className="legal__updated">Last updated {UPDATED}</p>

        <p className="legal__lead">
          Seat Planner is a railway ticketing demonstration. It is not operated by, or affiliated with, Bangladesh
          Railway, and tickets from it are not valid for travel. This page says what it keeps about you and why.
        </p>

        <h2>What is kept</h2>
        <ul>
          <li>
            <strong>Your account:</strong> name, email address and password. The password is stored only as a
            one-way hash; nobody can read it back.
          </li>
          <li>
            <strong>Your travel profile and passengers:</strong> the name, National ID number and date of birth
            printed on each ticket, because a ticket is valid only for the person named on it.
          </li>
          <li>
            <strong>What you do with tickets:</strong> bookings, wallet top-ups and payments, returns, transfers,
            waitlist places, and ticket checks on board. Card and mobile-banking payments are simulated — no card
            or account numbers are ever entered or stored.
          </li>
          <li>
            <strong>A security log:</strong> sign-ins (including failed ones), account changes and staff actions,
            each with the IP address and browser it came from. It is how misuse of an account is noticed and
            investigated.
          </li>
        </ul>

        <h2>What it is used for</h2>
        <p>
          Only to run the service: to sign you in, sell and check tickets, return money you are owed, and keep
          accounts safe. Nothing is sold, shared for marketing, or used for advertising, and the site carries no
          advertising or tracking scripts.
        </p>

        <h2>Email</h2>
        <p>
          The service emails you verification and password-reset codes, your tickets, and notices about your
          journeys — for example if a departure is cancelled and refunded. These are sent through Google&apos;s
          Gmail service, from the service&apos;s own address. Seat Planner only sends email; it never reads
          anyone&apos;s mailbox.
        </p>

        <h2>Who else handles it</h2>
        <p>The service runs on hosted infrastructure, and these providers process data on its behalf:</p>
        <ul>
          <li>Vercel — serves the website</li>
          <li>Render — runs the application server</li>
          <li>Aiven — hosts the main database</li>
          <li>MongoDB Atlas — hosts the security log</li>
          <li>Google — delivers email</li>
        </ul>

        <h2>In your browser</h2>
        <p>
          Your browser keeps the tokens that keep you signed in, and one display setting — which way seat maps
          are turned. There are no advertising or analytics cookies. Signing out removes the sign-in tokens.
        </p>

        <h2>How long it is kept, and removing it</h2>
        <p>
          Your data is kept while your account exists. Records of payments and refunds are kept as long as the
          money they describe needs accounting for. To have your account and its data deleted, or to ask what is
          held about you, reply to any email the service has sent you.
        </p>

        <h2>Changes</h2>
        <p>If what is kept or how it is used changes, this page changes with it, and the date above moves.</p>
      </article>
    </main>
  );
}
