"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "primereact/dialog";
import Select from "@/components/ui/Select";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import { fetchComposition, saveComposition } from "@/lib/departures";
import { listPlans } from "@/lib/plans";

import { tip } from "@/components/ui/tip";
/** Bangladesh Railway coach letters, in the order they are normally assigned. */
const COACH_CODES = ["KA", "KHA", "GA", "GHA", "UMA", "CHA", "SCHA", "JA", "JHA", "NEO", "TA", "THA", "DA"];

export default function CompositionEditor({ train, visible, onHide, onSaved, canEdit }) {
  const [coaches, setCoaches] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible || !train) return;
    setError(null);
    setLoading(true);
    Promise.all([fetchComposition(train.id), listPlans({ templates: 1 })])
      .then(([composition, planList]) => {
        setCoaches(composition.map((c) => ({ ...c })));
        setPlans(planList);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [visible, train]);

  // Plans are copied per train, so a coach number alone repeats across trains:
  // each option names its train, and this train's own plans come first.
  const planOptions = useMemo(
    () =>
      [...plans]
        .sort((a, b) => (b.trainNameId === train?.id) - (a.trainNameId === train?.id))
        .map((p) => ({
          label:
            `${p.coachNo || "Untitled"} — ${p.coachClass?.name || "no class"}` +
            `${p.trainNameId === train?.id ? "" : ` · ${p.trainName?.name || "no train"}`}` +
            `${p.status === "approved" ? "" : ` (${p.status})`}`,
          value: p.id,
          status: p.status,
        })),
    [plans, train]
  );

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);

  const totals = useMemo(() => {
    const seats = coaches.reduce((n, c) => n + (c.seatCount || 0), 0);
    const pending = coaches.filter((c) => {
      const plan = planById.get(c.seatPlanId);
      return plan ? plan.status !== "approved" : !c.planApproved;
    }).length;
    return { seats, pending };
  }, [coaches, planById]);

  const nextCode = () => COACH_CODES.find((code) => !coaches.some((c) => c.coachCode === code)) || "";

  const patch = (index, changes) =>
    setCoaches((prev) => prev.map((c, i) => (i === index ? { ...c, ...changes } : c)));

  const move = (index, delta) =>
    setCoaches((prev) => {
      const next = [...prev];
      const [row] = next.splice(index, 1);
      next.splice(index + delta, 0, row);
      return next;
    });

  const duplicateCodes = useMemo(() => {
    const seen = new Set();
    const dupes = new Set();
    coaches.forEach((c) => {
      const code = (c.coachCode || "").toUpperCase();
      if (seen.has(code)) dupes.add(code);
      seen.add(code);
    });
    return dupes;
  }, [coaches]);

  const problems = [];
  if (coaches.some((c) => !c.coachCode?.trim())) problems.push("Every coach needs a code");
  if (coaches.some((c) => !c.seatPlanId)) problems.push("Every coach needs a seat plan");
  if (duplicateCodes.size) problems.push(`Duplicate coach code: ${[...duplicateCodes].join(", ")}`);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await saveComposition(
        train.id,
        coaches.map((c) => ({ coachCode: c.coachCode.trim().toUpperCase(), seatPlanId: c.seatPlanId }))
      );
      onSaved?.(result.message);
      onHide();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      header={train ? `Coaches — ${train.name}` : "Coaches"}
      visible={visible}
      style={{ width: "56rem", maxWidth: "96vw" }}
      onHide={onHide}
      footer={
        <>
          <Button label="Close" text onClick={onHide} disabled={saving} />
          <Button
            label="Save composition"
            icon="pi pi-check"
            loading={saving}
            disabled={!canEdit || problems.length > 0}
            onClick={save}
          />
        </>
      }
    >
      <div className="route-summary">
        <Tag value={`${coaches.length} coaches`} severity="info" />
        <Tag value={`${totals.seats} seats`} severity="info" />
        {totals.pending > 0 && (
          <Tag value={`${totals.pending} awaiting approval`} severity="warning" icon="pi pi-clock" />
        )}
      </div>

      <p className="route-hint">
        This is the line-up the train normally runs with. Each generated departure takes its own
        copy, so pulling a coach off one day never touches another. Seats are only built from
        <strong> approved</strong> layouts.
      </p>

      {error && <Message severity="error" text={error} style={{ width: "100%", marginBottom: "0.75rem" }} />}

      {problems.length > 0 && (
        <Message
          severity="warn"
          style={{ width: "100%", marginBottom: "0.75rem" }}
          text={problems.join(" · ")}
        />
      )}

      <div className="route-table-scroll">
        <table className="route-table">
          <thead>
            <tr>
              <th style={{ width: "2.5rem" }}>#</th>
              <th style={{ width: "8rem" }}>Coach</th>
              <th>Seat plan</th>
              <th style={{ width: "6rem" }}>Seats</th>
              <th style={{ width: "8rem" }}>Status</th>
              <th style={{ width: "8rem" }}></th>
            </tr>
          </thead>
          <tbody>
            {coaches.map((coach, i) => {
              const plan = planById.get(coach.seatPlanId);
              const approved = plan ? plan.status === "approved" : coach.planApproved;
              return (
                <tr key={i}>
                  <td className="route-seq">{i + 1}</td>
                  <td>
                    <InputText
                      value={coach.coachCode || ""}
                      onChange={(e) => patch(i, { coachCode: e.target.value.toUpperCase() })}
                      disabled={!canEdit}
                      style={{
                        width: "100%",
                        textTransform: "uppercase",
                        ...(duplicateCodes.has((coach.coachCode || "").toUpperCase())
                          ? { borderColor: "#dc2626" }
                          : {}),
                      }}
                    />
                  </td>
                  <td>
                    <Select
                      value={coach.seatPlanId}
                      options={planOptions}
                      onChange={(e) =>
                        patch(i, {
                          seatPlanId: e.value,
                          seatCount: undefined,
                        })
                      }
                      filter
                      placeholder="Choose a layout"
                      disabled={!canEdit}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>{coach.seatCount ?? "—"}</td>
                  <td>
                    {approved ? (
                      <Tag value="Approved" severity="success" />
                    ) : (
                      <Tag value="Pending" severity="warning" />
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.15rem", justifyContent: "flex-end" }}>
                      <Button {...tip("Move coach up")} icon="pi pi-angle-up" rounded text size="small" disabled={!canEdit || i === 0} onClick={() => move(i, -1)} />
                      <Button {...tip("Move coach down")} icon="pi pi-angle-down" rounded text size="small" disabled={!canEdit || i === coaches.length - 1} onClick={() => move(i, 1)} />
                      <Button {...tip("Remove this coach")}
                        icon="pi pi-trash"
                        rounded
                        text
                        severity="danger"
                        size="small"
                        disabled={!canEdit}
                        onClick={() => setCoaches((prev) => prev.filter((_, idx) => idx !== i))}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button
        label="Add coach"
        icon="pi pi-plus"
        outlined
        style={{ marginTop: "0.75rem" }}
        disabled={!canEdit || loading}
        onClick={() => setCoaches((prev) => [...prev, { coachCode: nextCode(), seatPlanId: null }])}
      />
    </Dialog>
  );
}
