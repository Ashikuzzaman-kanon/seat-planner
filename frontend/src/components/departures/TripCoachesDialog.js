"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";
import { confirmDialog } from "primereact/confirmdialog";
import Select from "@/components/ui/Select";
import { tip } from "@/components/ui/tip";
import {
  fetchTripCoaches,
  addTripCoach,
  removeTripCoach,
  cancelTripCoach,
  reinstateTripCoach,
} from "@/lib/departures";
import { listPlans } from "@/lib/plans";
import CancelWithReason from "./CancelWithReason";
import "./ops.css";

/**
 * The coaches on one departure, and what may be done to each (§14.1).
 *
 * - **Add** a coach from an approved seat plan — the most common reason is a
 *   sold-out train, and its new seats go to the waitlist first.
 * - **Remove** a coach nobody has used. Refused outright for any coach with a
 *   ticket, a checkout or history on it; cancel that instead.
 * - **Cancel** a coach, refunding everyone on it in full and telling them why.
 *   The refunds run as a background job; this only starts it.
 * - **Reinstate** a cancelled coach. Its seats go back on sale; its passengers
 *   stay refunded.
 *
 * The server decides which of these each coach allows (`canRemove`, …), so the
 * buttons shown are the ones that will work.
 */
export default function TripCoachesDialog({ trip, visible, onHide, canManage, canCancel, onRefundJob, notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState([]);
  const [adding, setAdding] = useState({ seatPlanId: null, coachCode: "", position: "" });
  const [busy, setBusy] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(async () => {
    if (!trip) return;
    setLoading(true);
    try {
      setData(await fetchTripCoaches(trip.id));
    } catch (err) {
      notify("error", "Could not load the coaches", err.message);
    } finally {
      setLoading(false);
    }
  }, [trip, notify]);

  useEffect(() => {
    if (!visible) return;
    setAdding({ seatPlanId: null, coachCode: "", position: "" });
    load();
    if (canManage) listPlans({ status: "approved" }).then(setPlans).catch(() => setPlans([]));
  }, [visible, load, canManage]);

  const planOptions = useMemo(
    () =>
      plans.map((p) => ({
        label: `${p.coachNo} — ${p.trainName?.name || "?"} · ${p.coachClass?.name || "class ?"}`,
        value: p.id,
      })),
    [plans]
  );

  const changeable = data && !["departed", "completed"].includes(data.status);

  const add = async () => {
    setBusy("add");
    try {
      const result = await addTripCoach(trip.id, {
        seatPlanId: adding.seatPlanId,
        coachCode: adding.coachCode.trim(),
        position: adding.position ? Number(adding.position) : undefined,
      });
      notify("success", "Coach added", result.message);
      setAdding({ seatPlanId: null, coachCode: "", position: "" });
      load();
    } catch (err) {
      notify("error", "Could not add it", err.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = (coach) =>
    confirmDialog({
      header: `Remove ${coach.coachCode}?`,
      message: "Nobody has used it, so it simply goes. Its seats are deleted with it.",
      icon: "pi pi-trash",
      acceptClassName: "p-button-danger",
      acceptLabel: "Remove it",
      rejectLabel: "Keep it",
      accept: async () => {
        setBusy(coach.id);
        try {
          const result = await removeTripCoach(trip.id, coach.id);
          notify("success", "Coach removed", result.message);
          load();
        } catch (err) {
          notify("error", "Could not remove it", err.message);
        } finally {
          setBusy(null);
        }
      },
    });

  const reinstate = (coach) =>
    confirmDialog({
      header: `Put ${coach.coachCode} back into service?`,
      message:
        "Its seats go on sale again — to the waitlist first. Passengers refunded when it was " +
        "cancelled keep their money and are not re-booked.",
      icon: "pi pi-replay",
      acceptLabel: "Reinstate",
      rejectLabel: "Leave it cancelled",
      accept: async () => {
        setBusy(coach.id);
        try {
          const result = await reinstateTripCoach(trip.id, coach.id, "Reinstated from the departure board");
          notify("success", "Back in service", result.note || result.message);
          load();
        } catch (err) {
          notify("error", "Could not reinstate it", err.message);
        } finally {
          setBusy(null);
        }
      },
    });

  const doCancel = async (reason) => {
    const coach = cancelling;
    try {
      const result = await cancelTripCoach(trip.id, coach.id, reason);
      setCancelling(null);
      if (result.refunded === null) {
        notify("info", `Coach ${coach.coachCode} cancelled`, result.message, 8000);
        onRefundJob?.({ label: `coach ${coach.coachCode}`, job: result.job });
      } else {
        notify("success", `Coach ${coach.coachCode} cancelled`, result.message, 8000);
      }
      load();
    } catch (err) {
      notify("error", "Could not cancel it", err.message);
    }
  };

  return (
    <Dialog
      header={trip ? `Coaches — ${trip.train?.name}, ${trip.departureDate}` : "Coaches"}
      visible={visible}
      onHide={onHide}
      style={{ width: "58rem", maxWidth: "96vw" }}
      draggable={false}
      className="coach-ops"
    >
      {loading && !data ? (
        <div className="coach-ops__centre">
          <ProgressSpinner style={{ width: 34, height: 34 }} />
        </div>
      ) : data ? (
        <>
          {!changeable && (
            <Message
              severity="info"
              className="w-full coach-ops__note"
              text={`This departure has ${data.status}; its coaches can no longer change.`}
            />
          )}

          <ul className="coach-ops__list">
            {data.coaches.map((coach) => {
              const cancelled = coach.status === "cancelled";
              return (
                <li key={coach.id} className={`coach-ops__row${cancelled ? " is-cancelled" : ""}`}>
                  <span className="coach-ops__pos" title={`Position ${coach.position} in the train`}>
                    {coach.position}
                  </span>
                  <div className="coach-ops__main">
                    <div className="coach-ops__title">
                      <strong>{coach.coachCode}</strong>
                      <Tag
                        value={cancelled ? "Cancelled" : "In service"}
                        severity={cancelled ? "danger" : "success"}
                      />
                    </div>
                    <small>
                      {coach.seatCount} seats · plan {coach.planCoachNo || "—"} ·{" "}
                      <b>{coach.passengers}</b> passenger{coach.passengers === 1 ? "" : "s"}
                      {coach.checkoutsInProgress ? ` · ${coach.checkoutsInProgress} checkout(s) open` : ""}
                    </small>
                    {cancelled && coach.cancellationReason && (
                      <small className="coach-ops__reason">“{coach.cancellationReason}”</small>
                    )}
                  </div>
                  <div className="coach-ops__actions">
                    {changeable && canCancel && coach.canCancel && (
                      <Button
                        label="Cancel"
                        icon="pi pi-ban"
                        severity="danger"
                        outlined
                        size="small"
                        disabled={busy !== null}
                        onClick={() => setCancelling(coach)}
                      />
                    )}
                    {changeable && canCancel && coach.canReinstate && (
                      <Button
                        label="Reinstate"
                        icon="pi pi-replay"
                        outlined
                        size="small"
                        loading={busy === coach.id}
                        disabled={busy !== null && busy !== coach.id}
                        onClick={() => reinstate(coach)}
                      />
                    )}
                    {changeable && canManage && coach.canRemove && (
                      <Button
                        {...tip("Remove this unused coach")}
                        icon="pi pi-trash"
                        severity="danger"
                        text
                        rounded
                        loading={busy === coach.id}
                        disabled={busy !== null && busy !== coach.id}
                        onClick={() => remove(coach)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {changeable && canManage && (
            <section className="coach-ops__add">
              <h4>Add a coach</h4>
              <p>From an approved seat plan. Its seats go to anyone waiting for this train first.</p>
              <div className="coach-ops__add-row">
                <Select
                  value={adding.seatPlanId}
                  options={planOptions}
                  onChange={(e) => setAdding((a) => ({ ...a, seatPlanId: e.value }))}
                  placeholder="Approved seat plan"
                  filter
                  className="coach-ops__plan"
                  emptyMessage="No approved plans"
                />
                <InputText
                  value={adding.coachCode}
                  onChange={(e) => setAdding((a) => ({ ...a, coachCode: e.target.value.toUpperCase() }))}
                  placeholder="Code, e.g. JHA"
                  maxLength={10}
                  aria-label="Coach code"
                  className="coach-ops__code"
                />
                <InputText
                  value={adding.position}
                  onChange={(e) => setAdding((a) => ({ ...a, position: e.target.value.replace(/\D/g, "") }))}
                  placeholder="Position (end)"
                  inputMode="numeric"
                  aria-label="Position in the train — leave empty to add at the end"
                  className="coach-ops__position"
                />
                <Button
                  label="Add coach"
                  icon="pi pi-plus"
                  loading={busy === "add"}
                  disabled={!adding.seatPlanId || !adding.coachCode.trim() || (busy !== null && busy !== "add")}
                  onClick={add}
                />
              </div>
            </section>
          )}
        </>
      ) : null}

      <CancelWithReason
        visible={Boolean(cancelling)}
        onHide={() => setCancelling(null)}
        title={cancelling ? `Cancel coach ${cancelling.coachCode}` : "Cancel coach"}
        intro={
          cancelling
            ? `${cancelling.passengers} passenger(s) on it are refunded their full fare, with nothing ` +
              "deducted, and emailed the reason below. Anyone mid-checkout on it loses the seats now. " +
              "The refunds run in the background."
            : ""
        }
        placeholder="e.g. Air conditioning failed in this coach"
        onConfirm={doCancel}
      />
    </Dialog>
  );
}
