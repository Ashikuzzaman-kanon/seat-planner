"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "primereact/button";
import { ProgressSpinner } from "primereact/progressspinner";
import { useAuth } from "@/contexts/AuthContext";
import { publicMeta, publicList, publicPass, currentPass } from "@/lib/publicAllocation";
import Explorer from "@/components/allocation/Explorer";
import BotCheck from "@/components/allocation/BotCheck";
import SourceNotice, { OFFICIAL_SITE } from "@/components/allocation/SourceNotice";
import "@/components/allocation/allocation.css";
import "./public.css";

const NEXT = "/seat-allocation";

/**
 * Seat Allocation for everyone, without signing in: which trains have seats
 * set aside for a journey, class by class — the same search as in the app,
 * read-only. A shop window for the site.
 *
 * A few searches a day are free; then the visitor is invited to sign in or
 * create a free account, after which searches are unlimited. A bot check
 * (when set up) runs once a visit, out of sight unless it is unsure.
 */
export default function PublicSeatAllocation() {
  const { user, loading: authLoading } = useAuth();
  const [meta, setMeta] = useState(null);
  const [state, setState] = useState("loading");
  const [passed, setPassed] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      setMeta(await publicMeta());
      setState("open");
    } catch (err) {
      setState(err.code === "PUBLIC_OFF" ? "off" : err.code === "RATE_LIMITED" ? "busy" : "error");
    }
  }, []);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  const needsCheck = Boolean(meta?.botCheck) && !meta?.signedIn && !passed && !currentPass();

  const takeToken = useCallback(async (token) => {
    try {
      await publicPass(token);
      setPassed(true);
    } catch {
      setPassed(false);
    }
  }, []);

  const fetchList = useCallback((params) => publicList(params), []);

  const renderBlocked = useCallback(
    (err, retry) => {
      if (err.code === "SIGN_IN_REQUIRED") return <SignInInvite free={err.details?.freeSearches} />;
      if (err.code === "BOT_CHECK" && meta?.botCheck) {
        return (
          <section className="card pub-message">
            <h2>One moment</h2>
            <p>Checking that you are not a robot…</p>
            <BotCheck
              siteKey={meta.botCheck.siteKey}
              onToken={async (token) => {
                await takeToken(token);
                retry();
              }}
            />
          </section>
        );
      }
      if (err.code === "RATE_LIMITED") {
        return (
          <section className="card pub-message">
            <h2>Too many searches at once</h2>
            <p>{err.message}</p>
            <Button label="Try again" icon="pi pi-refresh" outlined onClick={retry} />
          </section>
        );
      }
      return null;
    },
    [meta, takeToken]
  );

  return (
    <div className="pub">
      <header className="pub-head">
        <Link href={user ? "/dashboard" : "/login"} className="pub-brand" aria-label="Seat Planner">
          <span className="pub-brand__mark" aria-hidden="true">
            <i className="pi pi-ticket" />
          </span>
          <strong>Seat Planner</strong>
        </Link>
        <nav className="pub-head__actions" aria-label="Account">
          {user ? (
            <Link href="/dashboard" className="p-button p-button-sm">
              Open the app
            </Link>
          ) : (
            <>
              <Link href={`/login?next=${encodeURIComponent(NEXT)}`} className="p-button p-button-sm p-button-text">
                Sign in
              </Link>
              <Link href="/register" className="p-button p-button-sm">
                Create a free account
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="pub-main al">
        <div className="al-head">
          <h1 className="page-title">Seat Allocation</h1>
          <p className="page-subtitle">
            Which trains have seats set aside for your journey, class by class. Free — no account needed.
          </p>
        </div>

        {state === "loading" && (
          <div className="al-loading">
            <ProgressSpinner style={{ width: 40, height: 40 }} strokeWidth="4" />
          </div>
        )}

        {state === "off" && (
          <section className="card pub-message">
            <h2>Not available right now</h2>
            <p>Seat Allocation is not open to the public at the moment. Please come back later.</p>
            <Link href={`/login?next=${encodeURIComponent(NEXT)}`} className="p-button p-button-outlined">
              Sign in
            </Link>
          </section>
        )}

        {(state === "error" || state === "busy") && (
          <section className="card pub-message">
            <h2>{state === "busy" ? "Too many requests" : "Could not load"}</h2>
            <p>
              {state === "busy"
                ? "There are a lot of requests from your connection just now. Wait a moment and try again."
                : "Something went wrong loading Seat Allocation. Check your connection and try again."}
            </p>
            <Button label="Try again" icon="pi pi-refresh" outlined onClick={load} />
          </section>
        )}

        {state === "open" && meta && (
          <>
            <SourceNotice lastUpdated={meta.lastUpdated} />
            {needsCheck ? (
              <section className="card pub-message">
                <p>Checking that you are not a robot…</p>
                <BotCheck siteKey={meta.botCheck.siteKey} onToken={takeToken} />
              </section>
            ) : meta.totals?.pairs ? (
              <Explorer meta={meta} fetchList={fetchList} renderBlocked={renderBlocked} />
            ) : (
              <section className="card pub-message">
                <h2>Coming soon</h2>
                <p>The seat allocation has not been published yet. Please come back later.</p>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="pub-foot">
        <span>Seat Planner</span>
        <Link href="/privacy">Privacy</Link>
        <a href={OFFICIAL_SITE} target="_blank" rel="noopener noreferrer">
          Bangladesh Railway e-ticket
        </a>
        <span className="pub-foot__fine">Not affiliated with Bangladesh Railway.</span>
      </footer>
    </div>
  );
}

/** After the free searches: sign in or create a free account to keep going. */
function SignInInvite({ free }) {
  return (
    <section className="card pub-invite" role="status">
      <i className="pi pi-lock-open" aria-hidden="true" />
      <h2>Keep searching — it&apos;s free</h2>
      <p>
        You have used today&apos;s {free ? `${free} ` : ""}free searches. Sign in, or create a free account, to search
        as much as you like.
      </p>
      <div className="pub-invite__actions">
        <Link href={`/login?next=${encodeURIComponent(NEXT)}`} className="p-button">
          Sign in
        </Link>
        <Link href="/register" className="p-button p-button-outlined">
          Create a free account
        </Link>
      </div>
    </section>
  );
}
