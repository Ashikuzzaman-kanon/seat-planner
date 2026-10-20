"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { ProgressBar } from "primereact/progressbar";
import { confirmDialog } from "primereact/confirmdialog";
import PersonLink from "@/components/people/PersonLink";
import { followJob } from "@/lib/jobs";
import { applyRailwaySync, checkRailway, runsOnLabel } from "@/lib/railwayData";

const day = (value) =>
  value ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const when = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" })
    : "—";
const place = (name) => String(name || "").replace(/_/g, " ");
const times = (t) => [t.arrival, t.departure].filter(Boolean).join(" – ") + (t.dayOffset ? ` (+${t.dayOffset})` : "");

/**
 * Keeping the server in step with the railway.
 *
 * "Check with the railway" asks it for every train's timetable as it is now
 * and lists what differs here — nothing changes. "Apply" carries the newest
 * check out, compared again at that moment, and says what it did, what it
 * skipped and why. Both run in the background.
 */
export default function RailwaySync({ sync, otherJobRunning, onChanged, toast }) {
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const following = useRef(null);

  const follow = useCallback(
    (started, { applying }) => {
      following.current?.stop();
      setJob({ ...started, applying });
      const watcher = followJob(started.id, { onUpdate: (j) => setJob({ ...j, applying }), intervalMs: 1500 });
      following.current = watcher;
      watcher.done.then(async (finished) => {
        if (following.current !== watcher) return;
        following.current = null;
        setJob(null);
        await onChanged();
        if (!finished) return;
        if (finished.status !== "succeeded") {
          toast.current?.show({
            severity: "error",
            summary: applying ? "Applying stopped" : "The check stopped",
            detail: finished.lastError || "See Background Jobs for why.",
            life: 10000,
          });
        } else if (applying) {
          toast.current?.show({ severity: "success", summary: "The railway's timetable is applied", life: 6000 });
        } else {
          toast.current?.show({
            severity: finished.result?.upToDate ? "success" : "info",
            summary: finished.result?.upToDate ? "The server matches the railway" : "Changes found — review them below",
            life: 6000,
          });
        }
      });
    },
    [onChanged, toast]
  );

  // Pick up a check or apply already running when the page opens.
  useEffect(() => {
    if (sync?.job && !following.current) follow(sync.job, { applying: sync.job.type === "railway.sync_apply" });
  }, [sync?.job, follow]);
  useEffect(() => () => following.current?.stop(), []);

  const run = async (work, applying) => {
    setStarting(true);
    try {
      const { job: started } = await work();
      follow(started, { applying });
    } catch (err) {
      await onChanged();
      toast.current?.show({ severity: err.status === 409 ? "warn" : "error", summary: applying ? "Could not apply" : "Could not check", detail: err.message, life: 10000 });
    } finally {
      setStarting(false);
    }
  };

  const pending = sync?.pending;
  const lastApplied = sync?.lastApplied;
  const failedJob = !job && sync?.lastJob?.status === "failed" ? sync.lastJob : null;
  const busy = Boolean(job) || starting || otherJobRunning;

  const askApply = () =>
    confirmDialog({
      header: "Apply the railway's timetable?",
      icon: "pi pi-sync",
      message: (
        <div className="rd-confirm">
          <p>In the background, this brings the server in step with what was found, compared again as things are now:</p>
          <ul>
            <li>new trains and stations are added; renamed trains take their new names;</li>
            <li>moved times are taken — on trains with departures too — keeping the distances saved;</li>
            <li>changed stations are taken only on trains with no departures still to run;</li>
            <li>running days follow the railway where they were not set by hand.</li>
          </ul>
          <p>
            Coaches, seat plans and fares are not touched, and <strong>nothing is deleted</strong>.
          </p>
        </div>
      ),
      acceptLabel: "Apply",
      rejectLabel: "Cancel",
      accept: () => run(() => applyRailwaySync(pending.id), true),
    });

  return (
    <section className="card rd-sync" aria-labelledby="rd-sync-title">
      <div className="rd-section-head">
        <div>
          <h2 id="rd-sync-title">Sync with the railway</h2>
          <p>
            Ask the railway for its timetable as it is now, and see what differs here. Nothing changes until you apply it.
          </p>
        </div>
        <Button
          label="Check with the railway"
          icon="pi pi-sync"
          outlined
          onClick={() => run(checkRailway, false)}
          loading={starting && !job}
          disabled={busy}
        />
      </div>

      {job && <SyncProgress job={job} />}

      {failedJob && (
        <div className="rd-banner rd-banner--warn" role="alert">
          <i className="pi pi-exclamation-triangle" aria-hidden="true" />
          <div>
            <strong>{failedJob.type === "railway.sync_apply" ? "The last apply stopped" : "The last check stopped"}</strong>
            <p>{failedJob.lastError}</p>
          </div>
        </div>
      )}

      {!job && pending && <Review timetable={pending} onApply={askApply} busy={busy} />}

      {!job && !pending && lastApplied && <Applied timetable={lastApplied} />}

      {!job && !pending && !lastApplied && !failedJob && (
        <p className="rd-sync__never">Not checked yet. The server works from the timetable that came with it.</p>
      )}
    </section>
  );
}

function SyncProgress({ job }) {
  const p = job.progress;
  const pct = p?.total ? Math.round(((p.done ?? 0) / p.total) * 100) : 0;
  return (
    <div className="rd-job" aria-live="polite">
      <div className="rd-job__line">
        <i className="pi pi-spin pi-spinner" aria-hidden="true" />
        <strong>{job.applying ? "Applying the railway's timetable…" : "Checking with the railway…"}</strong>
        <span>
          {job.status === "queued"
            ? "waiting to start"
            : p?.step
              ? `${p.step}${p.total && !job.applying ? ` — ${p.done ?? 0} of ${p.total} trains` : ""}`
              : "starting"}
        </span>
      </div>
      <ProgressBar value={pct} showValue={false} />
      <small>
        Running in the background as <Link href={`/dashboard/jobs?focus=${job.id}`}>job #{job.id}</Link>. You can leave
        this page; it carries on.
      </small>
    </div>
  );
}

/** One kind of change, with how many, open when there are any. */
function Group({ title, count, note, children }) {
  if (!count) return null;
  return (
    <details className="rd-diff" open>
      <summary>
        {title} <span className="rd-diff__count">{count}</span>
      </summary>
      {note && <p className="rd-diff__note">{note}</p>}
      <ul className="rd-diff__list">{children}</ul>
    </details>
  );
}

function Review({ timetable, onApply, busy }) {
  const d = timetable.diff;
  const c = d.counts;
  return (
    <div className="rd-review">
      <p className="rd-review__head">
        <strong>Checked {when(timetable.fetchedAt)}</strong>
        {timetable.checkedBy && (
          <>
            {" by "}
            <PersonLink id={timetable.checkedBy.id} name={timetable.checkedBy.fullName} />
          </>
        )}{" "}
        — the railway&rsquo;s timetable for {day(timetable.requestedFor)}: {c.published} trains, {c.unchanged} as the server has them.
      </p>

      {d.upToDate ? (
        <div className="rd-banner rd-banner--info">
          <i className="pi pi-check-circle" aria-hidden="true" />
          <div>
            <strong>The server matches the railway</strong>
            <p>No train or station needs changing.</p>
          </div>
        </div>
      ) : (
        <div className="rd-review__apply">
          <span>Nothing has changed yet.</span>
          <Button label="Apply changes" icon="pi pi-check" onClick={onApply} disabled={busy} />
        </div>
      )}

      <Group title="New trains" count={c.newTrains} note="Added with their route. They get coaches once they have seat plans.">
        {d.newTrains.map((t) => (
          <li key={t.number}>
            <strong>{t.name}</strong>
            <span>
              {place(t.from)} → {place(t.to)} · {t.stops} stops · {runsOnLabel(t.runsOn)}
            </span>
          </li>
        ))}
      </Group>
      <Group title="New stations" count={c.newStations}>
        <li>
          <span>{d.newStations.map(place).join(", ")}</span>
        </li>
      </Group>
      <Group title="Renamed" count={c.renamed}>
        {d.renamed.map((t) => (
          <li key={t.number}>
            <strong>{t.from}</strong>
            <span>now {t.to}</span>
          </li>
        ))}
      </Group>
      <Group title="New times" count={c.times} note="Taken even on trains with departures. Saved distances, and so fares, stay as they are.">
        {d.times.map((t) => (
          <li key={t.number}>
            <strong>{t.name}</strong>
            {t.stops.map((s) => (
              <span key={s.station} className="rd-diff__stop">
                {place(s.station)}: <s>{times(s.from)}</s> → {times(s.to)}
              </span>
            ))}
          </li>
        ))}
      </Group>
      <Group title="Changed stations" count={c.stations}>
        {d.stations.map((t) => (
          <li key={t.number}>
            <strong>
              {t.name}{" "}
              {t.willApply ? (
                <Tag value="Will apply" severity="info" />
              ) : (
                <Tag value={`Skipped — ${t.upcoming} departure${t.upcoming === 1 ? "" : "s"} still to run`} severity="warning" />
              )}
            </strong>
            <span>
              {t.newRoute
                ? `A route of ${t.stops} stops, where it had none`
                : [
                    t.added.length && `adds ${t.added.map(place).join(", ")}`,
                    t.removed.length && `drops ${t.removed.map(place).join(", ")}`,
                    t.reordered && "puts its stops in another order",
                  ]
                    .filter(Boolean)
                    .join("; ")}
            </span>
          </li>
        ))}
      </Group>
      <Group title="Running days" count={c.days}>
        {d.days.map((t) => (
          <li key={t.number}>
            <strong>
              {t.name} {t.willApply ? <Tag value="Will apply" severity="info" /> : <Tag value="Set by hand — skipped" severity="warning" />}
            </strong>
            <span>
              {runsOnLabel(t.from)} → {runsOnLabel(t.to)}
            </span>
            {t.stranded.length > 0 && (
              <span className="rd-diff__warn">
                Departures on {t.stranded.map(day).join(", ")} fall on a day it will no longer run. They stay; cancel them on
                Departures if they should not run.
              </span>
            )}
          </li>
        ))}
      </Group>
      <Group title="No longer published" count={c.unpublished} note="Kept as they are. Nothing is deleted.">
        {d.unpublished.map((t) => (
          <li key={t.number}>
            <strong>{t.name}</strong>
          </li>
        ))}
      </Group>
      <Group title="The railway did not answer for" count={c.failed} note="Kept as they are. Check again later to compare them.">
        <li>
          <span>Train {d.failed.join(", ")}</span>
        </li>
      </Group>
    </div>
  );
}

function Applied({ timetable }) {
  const r = timetable.report || {};
  const rows = [
    ["Stations", `${r.stations?.created ?? 0} new`],
    ["Trains", `${r.trains?.created ?? 0} new · ${r.trains?.renamed ?? 0} renamed`],
    ["Routes", `${r.routes?.times ?? 0} new times · ${r.routes?.replaced ?? 0} replaced · ${r.routes?.skipped ?? 0} skipped`],
    ["Running days", `${r.days?.updated ?? 0} updated · ${r.days?.skipped ?? 0} skipped`],
  ];
  return (
    <div className="rd-review">
      <p className="rd-review__head">
        <strong>Last applied {when(timetable.appliedAt)}</strong>
        {timetable.appliedBy && (
          <>
            {" by "}
            <PersonLink id={timetable.appliedBy.id} name={timetable.appliedBy.fullName} />
          </>
        )}{" "}
        — the railway&rsquo;s timetable for {day(timetable.requestedFor)}. The server works from it.
      </p>
      <dl className="rd-summary">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {r.stranded?.length > 0 && (
        <ul className="rd-notes rd-notes--warn">
          {r.stranded.map((s) => (
            <li key={s.trainId}>
              <i className="pi pi-calendar-times" aria-hidden="true" />
              {s.name} — now runs: {runsOnLabel(s.runsOn)}. Its departures on {s.dates.map(day).join(", ")}, a day it no longer runs, were kept.
            </li>
          ))}
        </ul>
      )}
      {r.warnings?.length > 0 && (
        <ul className="rd-notes rd-notes--warn">
          {r.warnings.map((w) => (
            <li key={w}>
              <i className="pi pi-exclamation-triangle" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
