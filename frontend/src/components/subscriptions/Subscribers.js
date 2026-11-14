"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Paginator } from "primereact/paginator";
import { Tag } from "primereact/tag";
import DataTable from "@/components/ui/DataTable";
import SearchBox from "@/components/ui/SearchBox";
import Select from "@/components/ui/Select";
import { tip } from "@/components/ui/tip";
import Chips from "./Chips";
import DeviceCounts from "./DeviceCounts";
import DevicesDialog from "./DevicesDialog";
import PeriodPicker, { isChosen, lastDayOf } from "./PeriodPicker";
import ReasonDialog from "./ReasonDialog";
import PersonLink from "@/components/people/PersonLink";
import {
  amendSubscription,
  cancelSubscription,
  countsOf,
  describeDevices,
  endedLine,
  fetchMembers,
  hasEnded,
  longDate,
  resumeSubscription,
  sameCounts,
  statusMeta,
  totalOf,
} from "@/lib/subscriptions";

const STATUSES = [
  { label: "Running", value: "active" },
  { label: "Ended", value: "expired" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Declined", value: "declined" },
  { label: "All", value: null },
];

const PAGE_SIZE = 25;

/**
 * Who is subscribed to what, and who was.
 *
 * "Running" is the default because it is the list a reviewer acts on: each
 * row can be cancelled, or have its last day moved. One that ended — run
 * out, cancelled, declined — can be continued: the same record, running
 * again for a new period. Every row opens that person's devices — what the
 * subscription allows, what has signed in, and what was turned away.
 */
export default function Subscribers({ subscriptions, platforms, maxDevices, onChanged, notify }) {
  const [status, setStatus] = useState("active");
  const [subscriptionId, setSubscriptionId] = useState(null);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null); // { kind, member }
  const [period, setPeriod] = useState(null);
  const [counts, setCounts] = useState({});
  const [showing, setShowing] = useState(null); // the row whose devices are open

  /** Continue one that ended: the same length as last time, from today; the devices it had. */
  const startResume = (m) => {
    setPeriod({ days: m.lastLength || 30 });
    setCounts(countsOf(m.devices, platforms));
    setActing({ kind: "resume", member: m });
  };

  // Search as the typing settles, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(typed.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchMembers({ status, subscriptionId, search, page, limit: PAGE_SIZE }));
    } catch (err) {
      notify("error", "Could not load subscribers", err.message);
    } finally {
      setLoading(false);
    }
  }, [status, subscriptionId, search, page, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const options = useMemo(
    () => [{ label: "Every subscription", value: null }, ...subscriptions.map((s) => ({ label: s.name, value: s.id }))],
    [subscriptions]
  );

  const confirm = async (reason) => {
    const { kind, member } = acting;
    try {
      if (kind === "cancel") {
        await cancelSubscription(member.id, { reason });
        notify("info", "Cancelled", `${member.user.fullName} — ${member.subscription.name}`);
      } else if (kind === "resume") {
        // Sent only when changed, so an untouched one keeps the devices it had.
        const had = countsOf(member.devices, platforms);
        const done = await resumeSubscription(member.id, { period, devices: sameCounts(counts, had, platforms) ? undefined : counts });
        notify("success", "Continued", `${member.user.fullName} — ${member.subscription.name} until ${longDate(done.lastDay)}`);
      } else {
        const done = await amendSubscription(member.id, period);
        notify("success", "Last day changed", `${member.user.fullName} — now until ${longDate(done.lastDay)}`);
      }
      setActing(null);
      await Promise.all([load(), onChanged?.()]);
    } catch (err) {
      notify("error", "That did not work", err.message);
      load();
    }
  };

  const members = data?.members || [];

  return (
    <>
      <div className="card sub-filters">
        <Chips
          options={STATUSES}
          value={status}
          onChange={(picked) => {
            setStatus(picked);
            setPage(1);
          }}
          ariaLabel="Show"
        />
        <Select
          value={subscriptionId}
          options={options}
          onChange={(e) => {
            setSubscriptionId(e.value);
            setPage(1);
          }}
          placeholder="Every subscription"
          className="sub-filters__which"
          aria-label="Subscription"
        />
        <SearchBox
          value={typed}
          onChange={setTyped}
          placeholder="Name or email"
          resultCount={search ? data?.pagination?.total : undefined}
          noun="person"
          nounPlural="people"
          className="sub-filters__search"
        />
      </div>

      <div className="card sub-table">
        <DataTable value={members} loading={loading} dataKey="id" emptyMessage="Nobody here.">
          <Column
            header="Person"
            body={(m) => (
              <div className="sub-person">
                <strong>
                  <PersonLink id={m.user.id} name={m.user.fullName} />
                </strong>
                <small>{m.user.email}</small>
              </div>
            )}
          />
          <Column header="Subscription" body={(m) => m.subscription.name} />
          <Column header="Devices" body={(m) => <span className="sub-table__devices">{describeDevices(m.devices)}</span>} />
          <Column
            header="Status"
            body={(m) => {
              const meta = statusMeta(m.status);
              return <Tag value={m.status === "active" ? "Running" : meta.label} severity={meta.severity} />;
            }}
          />
          <Column
            header="Last day"
            body={(m) =>
              m.lastDay ? (
                <div className="sub-person">
                  <span>{longDate(m.lastDay)}</span>
                  {m.decidedBy && m.startsAt && (
                    <small>
                      approved by <PersonLink id={m.decidedById} name={m.decidedBy} />
                    </small>
                  )}
                </div>
              ) : (
                <span className="sub-muted">—</span>
              )
            }
          />
          <Column
            header="How it ended"
            body={(m) => {
              if (m.status === "cancelled") {
                return (
                  <div className="sub-person">
                    <span>
                      {m.endedBy ? (
                        <>
                          By <PersonLink id={m.endedById} name={m.endedBy} />
                        </>
                      ) : (
                        "Cancelled"
                      )}
                    </span>
                    {m.endReason && <small>“{m.endReason}”</small>}
                  </div>
                );
              }
              if (m.status === "declined") {
                return (
                  <div className="sub-person">
                    <span>
                      {m.decidedBy ? (
                        <>
                          By <PersonLink id={m.decidedById} name={m.decidedBy} />
                        </>
                      ) : (
                        "Declined"
                      )}
                    </span>
                    {m.decisionNote && <small>“{m.decisionNote}”</small>}
                  </div>
                );
              }
              if (m.status === "expired") return "Ran its full period";
              return <span className="sub-muted">—</span>;
            }}
          />
          <Column
            header="Before"
            body={(m) =>
              m.history?.length ? (
                <span className="sub-continued" title={m.history.map((h) => endedLine(h, { userId: m.user.id })).join("\n")}>
                  <i className="pi pi-history" aria-hidden="true" /> continued {m.history.length}×
                </span>
              ) : (
                <span className="sub-muted">—</span>
              )
            }
          />
          <Column
            header=""
            className="sub-table__actions"
            body={(m) => (
              <>
                <Button
                  icon="pi pi-desktop"
                  size="small"
                  text
                  rounded
                  onClick={() => setShowing(m)}
                  {...tip("Devices")}
                />
                {hasEnded(m) && (
                  <Button
                    icon="pi pi-replay"
                    size="small"
                    text
                    rounded
                    severity="success"
                    onClick={() => startResume(m)}
                    aria-label="Continue it"
                    {...tip("Continue it")}
                  />
                )}
                {m.valid && (
                  <>
                    <Button
                      icon="pi pi-calendar-plus"
                      size="small"
                      text
                      rounded
                      onClick={() => {
                        setPeriod({ lastDay: m.lastDay });
                        setActing({ kind: "extend", member: m });
                      }}
                      {...tip("Change the last day")}
                    />
                    <Button
                      icon="pi pi-times"
                      size="small"
                      text
                      rounded
                      severity="danger"
                      onClick={() => setActing({ kind: "cancel", member: m })}
                      {...tip("Cancel this subscription")}
                    />
                  </>
                )}
              </>
            )}
          />
        </DataTable>

        {data?.pagination?.pages > 1 && (
          <Paginator
            first={(data.pagination.page - 1) * data.pagination.limit}
            rows={data.pagination.limit}
            totalRecords={data.pagination.total}
            onPageChange={(e) => setPage(Math.floor(e.first / e.rows) + 1)}
          />
        )}
      </div>

      <DevicesDialog
        member={showing}
        platforms={platforms}
        maxDevices={maxDevices}
        onHide={() => setShowing(null)}
        onChanged={() => Promise.all([load(), onChanged?.()])}
        notify={notify}
      />

      <ReasonDialog
        visible={acting?.kind === "cancel"}
        header={`Cancel ${acting?.member.user.fullName || ""}’s subscription?`}
        message={`${acting?.member.subscription.name} stops for them straight away — it would otherwise run until ${longDate(acting?.member.lastDay)}. They are told, with your reason.`}
        confirmLabel="Cancel subscription"
        cancelLabel="Keep it"
        confirmIcon="pi pi-times"
        severity="danger"
        reasonLabel="Reason"
        reasonPlaceholder="Optional — shown to them"
        onConfirm={confirm}
        onHide={() => setActing(null)}
      />

      <ReasonDialog
        visible={acting?.kind === "extend"}
        header={`Change ${acting?.member.user.fullName || ""}’s last day`}
        message={`${acting?.member.subscription.name} currently runs until ${longDate(acting?.member.lastDay)}. Choose a new last day — later to extend it, earlier to shorten it. The day counts are from today.`}
        confirmLabel={`Run until ${longDate(lastDayOf(period)) || "…"}`}
        confirmIcon="pi pi-calendar-plus"
        canConfirm={isChosen(period) && lastDayOf(period) !== acting?.member.lastDay}
        onConfirm={confirm}
        onHide={() => setActing(null)}
      >
        {acting?.kind === "extend" && <PeriodPicker value={period} onChange={setPeriod} id="extend-period" />}
      </ReasonDialog>

      <ReasonDialog
        visible={acting?.kind === "resume"}
        header={`Continue ${acting?.member.user.fullName || ""}’s subscription`}
        message={
          acting?.kind === "resume"
            ? `${acting.member.subscription.name}: ${endedLine(
                {
                  status: acting.member.status,
                  startsAt: acting.member.startsAt,
                  lastDay: acting.member.lastDay,
                  endedAt: acting.member.status === "declined" ? acting.member.decidedAt : acting.member.endedAt,
                  endedById: acting.member.status === "cancelled" ? acting.member.endedById : null,
                  reason: acting.member.status === "declined" ? acting.member.decisionNote : acting.member.endReason,
                },
                { userId: acting.member.user.id }
              )}. It runs again from today — the same subscription, its history kept — and they are told.`
            : ""
        }
        confirmLabel={`Continue until ${longDate(lastDayOf(period)) || "…"}`}
        confirmIcon="pi pi-replay"
        canConfirm={isChosen(period) && totalOf(counts) > 0}
        onConfirm={confirm}
        onHide={() => setActing(null)}
      >
        {acting?.kind === "resume" && (
          <>
            {acting.member.status === "cancelled" && acting.member.endedById === acting.member.user.id && (
              <p className="sub-warning" role="note">
                <i className="pi pi-exclamation-triangle" aria-hidden="true" /> They cancelled it themselves
                {acting.member.endedAt ? ` on ${new Date(acting.member.endedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                {acting.member.endReason ? ` — “${acting.member.endReason}”` : ""}. Make sure they want it back.
              </p>
            )}
            <PeriodPicker value={period} onChange={setPeriod} id="resume-period" />
            <div className="sub-field">
              <span className="sub-field__label">
                Devices <span className="sub-field__optional">as it had — change them if you need to</span>
              </span>
              <DeviceCounts platforms={platforms} value={counts} onChange={setCounts} max={maxDevices} id="resume-devices" />
            </div>
          </>
        )}
      </ReasonDialog>
    </>
  );
}
