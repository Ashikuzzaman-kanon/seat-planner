"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ProgressBar } from "primereact/progressbar";
import { confirmDialog, ConfirmDialog } from "primereact/confirmdialog";
import { tip } from "@/components/ui/tip";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { followJob } from "@/lib/jobs";
import {
  fetchDemoStatus,
  populateDemo,
  clearDemo,
  createdSummary,
  DEMO_COUNT_LABELS,
  ACCOUNT_STATE,
  ROLE_LABELS,
} from "@/lib/demoData";
import "./demo-data.css";

/** "27 Sept 2026, 00:20" — for a moment inside a sentence, where `When`'s two lines would not fit. */
function At({ value }) {
  if (!value) return null;
  const at = new Date(value);
  const text = `${at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  return (
    <time dateTime={at.toISOString()} title={at.toLocaleString("en-GB")}>
      {text}
    </time>
  );
}

/**
 * Demo data.
 *
 * One screen for filling the system with demonstration data and taking it away
 * again. What it can promise, it says up front: existing things are adopted and
 * never changed, and deleting removes only what the demo made. What it cannot
 * do — delete while real people hold tickets on demo departures — it explains,
 * booking by booking, before anyone presses the button.
 *
 * Both actions run as background jobs; the screen follows them to the end.
 */
export default function DemoDataPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission(PERMISSIONS.DEMO_MANAGE);
  const toast = useRef(null);

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(null);
  const [copied, setCopied] = useState(null);
  const following = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchDemoStatus();
      setStatus(data);
      return data;
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not load demo data status", detail: err.message });
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /** Watch a job to the end, then say how it went and reload the status. */
  const follow = useCallback(
    (started) => {
      following.current?.stop();
      setJob(started);
      const watcher = followJob(started.id, { onUpdate: setJob, intervalMs: 1500 });
      following.current = watcher;
      watcher.done.then(async (finished) => {
        if (following.current !== watcher) return;
        following.current = null;
        setJob(null);
        await load();
        if (!finished) return;
        const deleting = finished.type === "demo.clear";
        if (finished.status === "succeeded") {
          toast.current?.show({
            severity: "success",
            summary: deleting ? "Demo data deleted" : "Demo data ready",
            detail: deleting
              ? "Everything the demo created is gone."
              : createdSummary(finished.result?.created, finished.result?.seats) || "Nothing was missing.",
            life: 6000,
          });
        } else {
          toast.current?.show({
            severity: "error",
            summary: deleting ? "Deleting stopped" : "Populating stopped",
            detail: finished.lastError || "See Background Jobs for why.",
            life: 10000,
          });
        }
      });
    },
    [load]
  );

  useEffect(() => {
    if (!canManage) return undefined;
    load().then((data) => {
      // A run started earlier — from this screen or another tab — is picked up where it is.
      if (data?.job) follow(data.job);
    });
    return () => following.current?.stop();
  }, [canManage, load, follow]);

  const start = async (action) => {
    setStarting(action);
    try {
      const { job: started } = await (action === "populate" ? populateDemo() : clearDemo());
      follow(started);
    } catch (err) {
      if (err.details?.blockers) await load();
      toast.current?.show({
        severity: err.status === 409 ? "warn" : "error",
        summary: action === "populate" ? "Could not populate" : "Could not delete",
        detail: err.message,
        life: 10000,
      });
    } finally {
      setStarting(null);
    }
  };

  const askPopulate = () =>
    confirmDialog({
      header: "Populate demo data",
      icon: "pi pi-box",
      message: (
        <div className="demo-confirm">
          <p>This creates, in the background:</p>
          <ul>
            <li>demo accounts for passengers, planners, admins and ticket checkers (no super admins);</li>
            <li>18 seat plans, 36 stations, and two trains with routes, fares and departures;</li>
            <li>sample bookings, returns, a transfer request, a ticket check and a report.</li>
          </ul>
          <p>
            Anything that already exists under the same name is used as it is and <strong>not changed</strong>.
          </p>
        </div>
      ),
      acceptLabel: "Populate",
      rejectLabel: "Cancel",
      accept: () => start("populate"),
    });

  const askClear = () =>
    confirmDialog({
      header: "Delete demo data",
      icon: "pi pi-exclamation-triangle",
      message: (
        <div className="demo-confirm">
          <p>This permanently removes everything the demo created:</p>
          <ul>
            <li>
              {status?.counts?.accounts ?? 0} account(s), {status?.counts?.departures ?? 0} departure(s) and{" "}
              {status?.counts?.bookings ?? 0} booking(s), with everything attached to them;
            </li>
            <li>anything the demo accounts did since, and any booking on a demo departure.</li>
          </ul>
          <p>Things the demo only adopted stay exactly as they are. This cannot be undone.</p>
        </div>
      ),
      acceptLabel: "Delete demo data",
      rejectLabel: "Cancel",
      acceptClassName: "p-button-danger",
      accept: () => start("clear"),
    });

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    } catch {
      toast.current?.show({ severity: "warn", summary: "Copy it by hand", detail: text });
    }
  };

  if (!canManage) {
    return (
      <div className="card">
        <h1 className="page-title">Demo data</h1>
        <p className="page-subtitle">Your account cannot manage demo data.</p>
      </div>
    );
  }

  const populated = Boolean(status?.populated);
  const blockers = status?.blockers || [];
  const busy = Boolean(job) || Boolean(starting);
  const last = status?.lastJob;

  return (
    <div className="demo-page">
      <Toast ref={toast} />
      <ConfirmDialog className="demo-confirm-dialog" />

      <div className="page-head">
        <div>
          <h1 className="page-title">Demo data</h1>
          <p className="page-subtitle">
            Fill the system with sample accounts, trains, departures and bookings to try it out — and remove
            them again. Existing data is never changed, and deleting removes only what the demo created.
          </p>
        </div>
      </div>

      {/* ---------------- Status and actions ---------------- */}
      <section className="card demo-status">
        <div className="demo-status__head">
          <div className="demo-status__state">
            <span className={`demo-dot${populated ? " is-on" : ""}`} aria-hidden="true" />
            <div>
              <strong>{loading ? "Loading…" : populated ? "Demo data is populated" : "No demo data"}</strong>
              <small>
                {last ? (
                  <>
                    Last {last.type === "demo.clear" ? "deleted" : "populated"} <At value={last.finishedAt} />
                    {last.status === "failed" ? " — it stopped part-way" : ""}
                  </>
                ) : (
                  "Nothing has been populated yet."
                )}
              </small>
            </div>
          </div>
          <div className="demo-status__actions">
            <Button
              label={populated ? "Populate again" : "Populate demo data"}
              icon="pi pi-plus-circle"
              onClick={askPopulate}
              loading={starting === "populate"}
              disabled={busy}
            />
            <Button
              label="Delete demo data"
              icon="pi pi-trash"
              severity="danger"
              outlined
              onClick={askClear}
              loading={starting === "clear"}
              disabled={busy || !populated || blockers.length > 0}
              {...(blockers.length && !busy ? tip("Deal with the tickets listed below first") : {})}
            />
          </div>
        </div>

        {job && <JobProgress job={job} />}

        {blockers.length > 0 && !job && (
          <div className="demo-blockers" role="alert">
            <i className="pi pi-lock" aria-hidden="true" />
            <div>
              <strong>Deleting is blocked while these tickets are valid</strong>
              {blockers.map((b) => (
                <div key={b.kind} className="demo-blocker">
                  <p>{b.message}</p>
                  <ul>
                    {b.bookings.map((booking) => (
                      <li key={booking.reference}>
                        <code>{booking.reference}</code> — {booking.email}, {booking.tickets} ticket
                        {booking.tickets === 1 ? "" : "s"}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="demo-counts">
          {DEMO_COUNT_LABELS.map(([key, label, icon]) => {
            const n = status?.counts?.[key] ?? 0;
            return (
              <div key={key} className={`demo-count${n ? "" : " is-zero"}`}>
                <b>{loading ? "–" : n.toLocaleString()}</b>
                <span>
                  <i className={icon} aria-hidden="true" />
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------------- Last run ---------------- */}
      {last && !job && <LastRun job={last} />}

      {/* ---------------- Accounts ---------------- */}
      <section className="card">
        <div className="demo-section-head">
          <h2>Demo accounts</h2>
          <p>
            Sign in as any of these to see the system from that role. Passwords are fixed and public, so these
            accounts are for trying things out only — a super admin account is never among them.
          </p>
        </div>

        <div className="demo-accounts">
          {(status?.accounts || []).map((a) => {
            const state = ACCOUNT_STATE[a.state] || ACCOUNT_STATE.missing;
            return (
              <div key={a.email} className={`demo-account is-${a.state}`}>
                <div className="demo-account__who">
                  <span className="demo-account__role">{ROLE_LABELS[a.role] || a.role}</span>
                  <span className="demo-account__email">
                    {a.email}
                    <Button
                      icon={copied === `e:${a.email}` ? "pi pi-check" : "pi pi-copy"}
                      text
                      rounded
                      size="small"
                      className="demo-copy"
                      onClick={() => copy(a.email, `e:${a.email}`)}
                      {...tip("Copy email")}
                    />
                  </span>
                </div>
                <div className="demo-account__password">
                  {a.password ? (
                    <>
                      <code>{a.password}</code>
                      <Button
                        icon={copied === `p:${a.email}` ? "pi pi-check" : "pi pi-copy"}
                        text
                        rounded
                        size="small"
                        className="demo-copy"
                        onClick={() => copy(a.password, `p:${a.email}`)}
                        {...tip("Copy password")}
                      />
                    </>
                  ) : (
                    <span className="demo-muted" title="This account existed before the demo and kept its own password">
                      its own password
                    </span>
                  )}
                </div>
                <Tag value={state.label} severity={state.severity} className="demo-account__state" />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** A populate or delete in progress. */
function JobProgress({ job }) {
  const p = job.progress;
  const pct = p?.total ? Math.round(((p.done ?? 0) / p.total) * 100) : 0;
  const deleting = job.type === "demo.clear";
  return (
    <div className="demo-job" aria-live="polite">
      <div className="demo-job__line">
        <i className="pi pi-spin pi-spinner" aria-hidden="true" />
        <strong>{deleting ? "Deleting demo data…" : "Populating demo data…"}</strong>
        <span>
          {job.status === "queued"
            ? "waiting to start"
            : p?.step && p.step !== "Done"
              ? `${p.step}${p.total ? ` — step ${Math.min((p.done ?? 0) + 1, p.total)} of ${p.total}` : ""}`
              : "finishing"}
        </span>
      </div>
      <ProgressBar value={pct} showValue={false} />
      <small>
        Running in the background as <Link href={`/dashboard/jobs?focus=${job.id}`}>job #{job.id}</Link>. You can
        leave this page; it carries on.
      </small>
    </div>
  );
}

/** What the last run did — and, for a populate, what it adopted instead of creating. */
function LastRun({ job }) {
  const r = job.result || {};
  const deleting = job.type === "demo.clear";
  const failed = job.status === "failed";
  const summary = deleting ? null : createdSummary(r.created, r.seats);
  const removed = deleting && r.removed ? r.removed : null;

  return (
    <section className={`card demo-last${failed ? " is-failed" : ""}`}>
      <div className="demo-section-head">
        <h2>
          {failed ? "The last run stopped" : deleting ? "Last deleted" : "Last populated"}{" "}
          <small>
            <At value={job.finishedAt} />
          </small>
        </h2>
      </div>

      {failed && <pre className="demo-error">{job.lastError}</pre>}

      {!failed && deleting && removed && (
        <p className="demo-summary">
          Removed {removed.accounts} account(s), {removed.departures} departure(s) and {removed.bookings} booking(s),
          with everything attached to them.
        </p>
      )}

      {!failed && !deleting && (
        <p className="demo-summary">{summary ? `Created ${summary}.` : "Everything was already there — nothing new was created."}</p>
      )}

      {r.warnings?.length > 0 && (
        <ul className="demo-notes demo-notes--warn">
          {r.warnings.map((w) => (
            <li key={w}>
              <i className="pi pi-exclamation-triangle" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {r.notes?.length > 0 && (
        <>
          <h3 className="demo-notes__title">Worth knowing</h3>
          <ul className="demo-notes">
            {r.notes.map((n) => (
              <li key={n}>
                <i className="pi pi-info-circle" aria-hidden="true" />
                {n}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
