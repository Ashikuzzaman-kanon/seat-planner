"use client";

import Link from "next/link";
import { ProgressBar } from "primereact/progressbar";
import { progressText } from "@/lib/jobs";
import "./ops.css";

/**
 * Refunds still being issued after the request that started them returned.
 *
 * Shown on the screen where the cancellation happened, so the operator sees
 * the refunds finish rather than wondering whether they did. The job carries
 * on whether or not anyone is watching; this is only a window onto it.
 */
export default function RefundJobBanner({ watch, canSeeJobs, onDismiss }) {
  if (!watch) return null;
  const { label, job } = watch;
  const p = job?.progress;
  const pct = p && p.total ? Math.round(((p.done ?? 0) / p.total) * 100) : null;
  const finished = job?.status === "succeeded" || job?.status === "failed";

  return (
    <section
      className={`refund-banner${job?.status === "failed" ? " is-failed" : finished ? " is-done" : ""}`}
      aria-live="polite"
    >
      <i
        className={`pi ${
          job?.status === "failed" ? "pi-times-circle" : finished ? "pi-check-circle" : "pi-spin pi-spinner"
        } refund-banner__icon`}
        aria-hidden="true"
      />
      <div className="refund-banner__text">
        <strong>
          {job?.status === "failed"
            ? `Refunds for ${label} stopped`
            : finished
              ? `Refunds for ${label} are done`
              : `Refunding everyone on ${label}…`}
        </strong>
        <small>
          {job?.status === "failed"
            ? "They will not retry again on their own. Open the job to see why, and send it round again."
            : finished
              ? job?.result?.refunded
                ? `${job.result.refunded} ticket(s) refunded in full. Each passenger is being emailed.`
                : "Nobody was aboard, so there was nothing to refund."
              : `Running in the background as job #${job?.id}${progressText(job) ? ` — ${progressText(job)} done` : ""}. You can leave this page; it carries on.`}
        </small>
        {!finished && pct !== null && <ProgressBar value={pct} showValue={false} className="refund-banner__bar" />}
      </div>
      <div className="refund-banner__actions">
        {canSeeJobs && (
          <Link href={`/dashboard/jobs?focus=${job?.id}`} className="refund-banner__link">
            Open job
          </Link>
        )}
        {finished && (
          <button type="button" className="refund-banner__close" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
            <i className="pi pi-times" aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
