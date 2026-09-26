"use client";

import { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Message } from "primereact/message";
import { requestTransfer } from "@/lib/postSale";

/**
 * Handing a ticket to someone else.
 *
 * Deliberately not instant. A ticket that could be reassigned freely would be a
 * bearer instrument — buy cheap seats early, sell them on later — so this
 * raises a request and says plainly that nothing changes until a person agrees.
 * Saying so up front is kinder than letting someone assume it is done.
 */

const NID = /^\d{10,17}$/;

export default function TransferTicketDialog({ ticket, visible, onHide, onRequested, onError }) {
  const [toName, setToName] = useState("");
  const [toNid, setToNid] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setToName("");
    setToNid("");
    setReason("");
    setTouched({});
  }, [visible]);

  const problems = {
    toName: toName.trim().length < 2 ? "Enter the new passenger's full name" : null,
    toNid: !NID.test(toNid.trim())
      ? "National ID is 10 to 17 digits"
      : toNid.trim() === ticket?.passengerNid
        ? "That is the National ID already on the ticket"
        : null,
  };

  const valid = !problems.toName && !problems.toNid;

  const submit = async () => {
    setSubmitting(true);
    try {
      const result = await requestTransfer({
        ticketId: ticket.id,
        toName: toName.trim(),
        toNid: toNid.trim(),
        reason: reason.trim() || undefined,
      });
      onRequested(result);
    } catch (err) {
      onError?.(err.message);
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      header={ticket ? `Transfer seat ${ticket.seatNumber}` : "Transfer ticket"}
      visible={visible}
      onHide={submitting ? () => {} : onHide}
      className="transfer-dialog"
      dismissableMask={!submitting}
      draggable={false}
    >
      {ticket && (
        <p className="transfer-current">
          Currently in the name of <strong>{ticket.passengerName}</strong>
          <span> (…{String(ticket.passengerNid || "").slice(-4)})</span>
        </p>
      )}

      <div className="passenger-fields transfer-fields">
        <div className="passenger-field">
          <label htmlFor="to-name">New passenger&apos;s name</label>
          <InputText
            id="to-name"
            value={toName}
            onChange={(e) => setToName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, toName: true }))}
            className={touched.toName && problems.toName ? "p-invalid" : ""}
            placeholder="As printed on their National ID"
          />
          {touched.toName && problems.toName && (
            <small className="field-error">{problems.toName}</small>
          )}
        </div>

        <div className="passenger-field">
          <label htmlFor="to-nid">Their National ID</label>
          <InputText
            id="to-nid"
            value={toNid}
            onChange={(e) => setToNid(e.target.value.replace(/\D/g, ""))}
            onBlur={() => setTouched((t) => ({ ...t, toNid: true }))}
            className={touched.toNid && problems.toNid ? "p-invalid" : ""}
            inputMode="numeric"
            placeholder="10 to 17 digits"
          />
          {touched.toNid && problems.toNid && <small className="field-error">{problems.toNid}</small>}
        </div>
      </div>

      <div className="passenger-field transfer-reason">
        <label htmlFor="transfer-reason">Why? (optional)</label>
        <InputTextarea
          id="transfer-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          autoResize
          maxLength={500}
          placeholder="Shown to whoever reviews this"
        />
      </div>

      <Message
        severity="info"
        className="book-message"
        text="Nothing changes on the ticket until this is approved. You will see it in your requests until then."
      />

      <div className="return-actions">
        <Button label="Cancel" text onClick={onHide} disabled={submitting} />
        <Button
          label="Request transfer"
          icon="pi pi-send"
          onClick={submit}
          loading={submitting}
          disabled={!valid}
        />
      </div>
    </Dialog>
  );
}
