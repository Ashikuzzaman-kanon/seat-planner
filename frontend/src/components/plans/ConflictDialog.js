"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { PLAN_STATUS_LABELS } from "@/constants/planStatus";

/**
 * Saving met another plan with the same train and coach number. What can be
 * done about it, each with why it may not be possible:
 *
 *   a. Replace it with mine — an approved plan: mine becomes its new layout
 *      once approved, every train and departure keeping it; the layout in use
 *      now is kept as a template.
 *   b. Move it to templates — not one a train's coaches use; an approved one
 *      only with the right to approve.
 *   c. Give it another coach number — an approved one only with the right to
 *      approve.
 *   d. Save mine as a template instead.
 *   e. Cancel.
 *
 * `clash` is the refusal's details: { plan: { id, status, coachNo, trainName,
 * revision }, usedBy: [train names] }.
 */
export default function ConflictDialog({ clash, canApprove, busy, onReplace, onMoveTheirs, onRenameTheirs, onKeepAsTemplate, onHide }) {
  const [coachNo, setCoachNo] = useState("");
  if (!clash) return null;
  const { plan, usedBy = [] } = clash;
  const approved = plan.status === "approved";
  const what = `${plan.trainName || "This train"} already has a seat plan for coach ${plan.coachNo}`;

  const option = (key, title, text, action, why) => (
    <div className={`pc-option${why ? " is-off" : ""}`} key={key}>
      <div className="pc-option__text">
        <strong>{title}</strong>
        <span>{why || text}</span>
      </div>
      {action}
    </div>
  );

  return (
    <Dialog header="This coach has a plan already" visible onHide={onHide} style={{ width: "min(36rem, 95vw)" }} className="pe-dialog pc">
      <div className="pe-dialog__body">
        <p>
          {what} — <strong>{PLAN_STATUS_LABELS[plan.status] || plan.status}</strong>
          {usedBy.length ? `, among the coaches of ${usedBy.join(", ")}` : ""}.{" "}
          <Link href={`/dashboard/plans/${plan.id}`} target="_blank">
            Open it
          </Link>
        </p>
        <div className="pc-options">
          {approved &&
            option(
              "replace",
              "Replace it with mine",
              "Mine becomes its new layout once approved — every train and departure keeps it. The layout in use now is kept as a template.",
              <Button label="Replace it" size="small" onClick={onReplace} loading={busy === "replace"} disabled={Boolean(busy) || Boolean(plan.revision)} />,
              plan.revision ? "It has changes waiting already — open the plan to see them." : null
            )}
          {option(
            "move",
            "Move it to templates",
            "It stops being a plan for this coach, kept to start others from — and mine takes the coach.",
            <Button label="Move it" size="small" outlined onClick={onMoveTheirs} loading={busy === "move"}
              disabled={Boolean(busy) || usedBy.length > 0 || (approved && !canApprove) || Boolean(plan.revision)} />,
            usedBy.length
              ? `${usedBy.join(", ")} ${usedBy.length === 1 ? "has" : "have"} it among the coaches — ${approved ? "replace it instead" : "put another plan there first"}.`
              : approved && !canApprove
              ? "It is in use: taking it out needs the right to approve plans."
              : plan.revision
              ? "It has changes waiting — finish or throw them away first."
              : null
          )}
          {option(
            "rename",
            "Give it another coach number",
            "Trains and departures that use it keep it — only its coach number changes.",
            <span className="pc-rename">
              <InputText value={coachNo} onChange={(e) => setCoachNo(e.target.value)} placeholder="New coach no" aria-label="Its new coach number"
                disabled={Boolean(busy) || (approved && !canApprove)} />
              <Button label="Change it" size="small" outlined onClick={() => onRenameTheirs(coachNo.trim())} loading={busy === "rename"}
                disabled={Boolean(busy) || !coachNo.trim() || (approved && !canApprove)} />
            </span>,
            approved && !canApprove ? "It is in use: changing its coach number needs the right to approve plans." : null
          )}
          {option(
            "template",
            "Save mine as a template instead",
            "Kept to start plans from — never used by trains, never in the way.",
            <Button label="Save as template" size="small" outlined onClick={onKeepAsTemplate} loading={busy === "template"} disabled={Boolean(busy)} />
          )}
        </div>
      </div>
      <div className="pe-dialog__foot">
        <Button label="Cancel" text onClick={onHide} disabled={Boolean(busy)} />
      </div>
    </Dialog>
  );
}
