"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import DataTable from "@/components/ui/DataTable";
import When from "@/components/ui/When";
import Select from "@/components/ui/Select";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { ProgressBar } from "primereact/progressbar";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { tip } from "@/components/ui/tip";
import {
  fetchJobs,
  retryJob,
  progressText,
  JOB_STATUS_LABELS,
  JOB_STATUS_SEVERITY,
  JOB_TYPE_LABELS,
} from "@/lib/jobs";
import "./jobs.css";

/**
 * Background jobs (Phase 8B).
 *
 * Work carried on after the request that started it: a cancelled departure's
 * refunds, and the email to each of its passengers. This screen answers the
 * three questions an operator has about that work — is it finished, how far has
 * it got, and if it stopped, why — and offers the one thing to do about a
 * failed job, which is to send it round again once the cause is dealt with.
 *
 * It refreshes itself while anything on it is still waiting or running, so a
 * mass refund can be watched to the end without pressing anything.
 */

const STATUSES = ["all", "queued", "running", "succeeded", "failed"];

function JobsInner() {
  const { hasPermission } = useAuth();
  const params = useSearchParams();
  const toast = useRef(null);

  const canView = hasPermission(PERMISSIONS.JOB_VIEW);
  const canManage = hasPermission(PERMISSIONS.JOB_MANAGE);

  const [status, setStatus] = useState("all");
  const [type, setType] = useState(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [retrying, setRetrying] = useState(null);

  const focus = Number(params.get("focus")) || null;

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        setData(await fetchJobs({ status, type: type || undefined, page, limit: 25 }));
      } catch (err) {
        toast.current?.show({ severity: "error", summary: "Could not load jobs", detail: err.message });
      } finally {
        setLoading(false);
      }
    },
    [status, type, page]
  );

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  // Open the job the operator came here for — the banner on Departures links with ?focus=.
  useEffect(() => {
    if (focus && data?.jobs?.some((j) => j.id === focus)) setExpanded((e) => ({ ...e, [focus]: true }));
  }, [focus, data]);

  // Keep watching while there is something to watch.
  const live = useMemo(() => (data?.jobs || []).some((j) => j.status === "queued" || j.status === "running"), [data]);
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load({ quiet: true });
    }, 4000);
    return () => clearInterval(t);
  }, [live, load]);

  const retry = async (job) => {
    setRetrying(job.id);
    try {
      const result = await retryJob(job.id);
      toast.current?.show({ severity: "success", summary: "Sent round again", detail: result.message });
      load({ quiet: true });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not retry it", detail: err.message });
    } finally {
      setRetrying(null);
    }
  };

  if (!canView) {
    return (
      <div className="card">
        <h1 className="page-title">Background jobs</h1>
        <p className="page-subtitle">Your account cannot view background jobs.</p>
      </div>
    );
  }

  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  const typeOptions = [
    { label: "All kinds", value: null },
    ...(data?.types || []).map((t) => ({ label: JOB_TYPE_LABELS[t] || t, value: t })),
  ];

  /* ---------------- Cells ---------------- */

  const whatBody = (job) => (
    <div className="job-what">
      <strong>{job.label || JOB_TYPE_LABELS[job.type] || job.type}</strong>
      <small>
        <code>{job.type}</code>
        {job.createdBy ? ` · started by ${job.createdBy.name || job.createdBy.email}` : ""}
      </small>
    </div>
  );

  const statusBody = (job) => (
    <Tag
      value={JOB_STATUS_LABELS[job.status] || job.status}
      severity={JOB_STATUS_SEVERITY[job.status]}
      icon={job.status === "running" ? "pi pi-spin pi-spinner" : undefined}
    />
  );

  const progressBody = (job) => {
    const p = job.progress;
    if (!p || !Number.isFinite(p.total)) return <span className="job-muted">—</span>;
    const pct = p.total ? Math.round(((p.done ?? 0) / p.total) * 100) : 100;
    return (
      <div className="job-progress">
        <ProgressBar value={pct} showValue={false} />
        <small>{progressText(job)}</small>
      </div>
    );
  };

  const attemptsBody = (job) => (
    <div className="job-attempts">
      <span>
        {job.attempts} / {job.maxAttempts}
      </span>
      {job.status === "queued" && job.attempts > 0 && (
        <small>
          retry <When value={job.runAfter} />
        </small>
      )}
    </div>
  );

  const actionsBody = (job) =>
    job.status === "failed" && canManage ? (
      <Button
        {...tip("Send it round again")}
        icon="pi pi-replay"
        rounded
        text
        loading={retrying === job.id}
        onClick={() => retry(job)}
      />
    ) : null;

  const details = (job) => (
    <div className="job-details">
      {job.lastError && (
        <section>
          <h4>{job.status === "failed" ? "Why it failed" : "Last error"}</h4>
          <pre className="job-error">{job.lastError}</pre>
        </section>
      )}
      <div className="job-details__grid">
        <section>
          <h4>What it was asked to do</h4>
          <pre>{JSON.stringify(job.payload, null, 2)}</pre>
        </section>
        <section>
          <h4>What it reported</h4>
          <pre>{job.result ? JSON.stringify(job.result, null, 2) : "Nothing yet"}</pre>
        </section>
      </div>
      <dl className="job-details__facts">
        <div>
          <dt>Queued</dt>
          <dd><When value={job.createdAt} /></dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd><When value={job.startedAt} /></dd>
        </div>
        <div>
          <dt>Finished</dt>
          <dd><When value={job.finishedAt} /></dd>
        </div>
      </dl>
    </div>
  );

  return (
    <div className="jobs-page">
      <Toast ref={toast} />

      <div className="page-head">
        <div>
          <h1 className="page-title">Background jobs</h1>
          <p className="page-subtitle">
            Work that carries on after the request that started it — a cancelled departure&apos;s
            refunds, and the email to each passenger. A job that fails is tried again, waiting longer
            each time; one that runs out of attempts waits here for a person.
          </p>
        </div>
        {live && (
          <span className="jobs-live" title="This page refreshes itself while jobs are running">
            <i className="pi pi-circle-fill" aria-hidden="true" /> Live
          </span>
        )}
      </div>

      <div className="card">
        <div className="jobs-filters" role="group" aria-label="Filter by status">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`jobs-filter${status === s ? " is-on" : ""} jobs-filter--${s}`}
              aria-pressed={status === s}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
            >
              {s === "all" ? "All" : JOB_STATUS_LABELS[s]}
              <b>{s === "all" ? total : counts[s] || 0}</b>
            </button>
          ))}
        </div>

        <div className="ui-toolbar">
          <Select
            value={type}
            options={typeOptions}
            onChange={(e) => {
              setType(e.value);
              setPage(1);
            }}
          />
          <div className="ui-toolbar__spacer" />
          <Button icon="pi pi-refresh" label="Refresh" outlined onClick={() => load()} />
        </div>

        <DataTable
          value={data?.jobs || []}
          loading={loading}
          dataKey="id"
          lazy
          paginator={(data?.pagination?.pages || 1) > 1}
          rows={25}
          totalRecords={data?.pagination?.total || 0}
          first={((data?.pagination?.page || 1) - 1) * 25}
          onPage={(e) => setPage(Math.floor(e.first / e.rows) + 1)}
          expandedRows={expanded}
          onRowToggle={(e) => setExpanded(e.data)}
          rowExpansionTemplate={details}
          emptyMessage={status === "failed" ? "Nothing has failed." : "No jobs here yet."}
          rowClassName={(job) => (job.id === focus ? "job-row--focus" : "")}
        >
          <Column expander style={{ width: "3rem" }} />
          <Column header="#" body={(j) => <span className="job-id">#{j.id}</span>} style={{ width: "5rem" }} />
          <Column header="What" body={whatBody} />
          <Column header="Status" body={statusBody} style={{ width: "8rem" }} />
          <Column header="Progress" body={progressBody} style={{ width: "11rem" }} />
          <Column header="Attempts" body={attemptsBody} style={{ width: "8rem" }} />
          <Column header="Queued" body={(j) => <When value={j.createdAt} />} style={{ width: "9rem" }} />
          <Column header="" body={actionsBody} style={{ width: "4rem" }} />
        </DataTable>
      </div>
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={null}>
      <JobsInner />
    </Suspense>
  );
}
