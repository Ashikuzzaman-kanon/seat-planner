"use client";

import { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputTextarea } from "primereact/inputtextarea";
import "./ops.css";

/**
 * Cancel something that has passengers on it, and say why.
 *
 * The reason is not a note for the audit log: every passenger refunded is
 * emailed it. So it is asked for in words, before anything happens — the
 * departure board used to cancel with the fixed text "Cancelled from the
 * departure board", and that is what passengers were told.
 */
export default function CancelWithReason({
  visible,
  onHide,
  title,
  intro,
  confirmLabel = "Cancel and refund everyone",
  placeholder = "e.g. Flooding on the line at Santahar",
  onConfirm,
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setReason("");
      setBusy(false);
    }
  }, [visible]);

  const words = reason.trim();
  const ready = words.length >= 5;

  const confirm = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await onConfirm(words);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      header={title}
      visible={visible}
      onHide={busy ? () => {} : onHide}
      style={{ width: "34rem", maxWidth: "94vw" }}
      draggable={false}
      footer={
        <div className="cancel-reason__actions">
          <Button label="Keep it running" text onClick={onHide} disabled={busy} />
          <Button
            label={confirmLabel}
            icon="pi pi-exclamation-triangle"
            severity="danger"
            onClick={confirm}
            loading={busy}
            disabled={!ready}
          />
        </div>
      }
    >
      <div className="cancel-reason">
        {intro && <p className="cancel-reason__intro">{intro}</p>}
        <label htmlFor="cancel-reason" className="cancel-reason__label">
          Reason <span>— every passenger refunded is emailed this</span>
        </label>
        <InputTextarea
          id="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          autoResize
          maxLength={500}
          placeholder={placeholder}
          className="w-full"
          autoFocus
        />
        <small className={`cancel-reason__hint${ready ? "" : " is-short"}`}>
          {ready ? `${words.length} / 500` : "A sentence, please — at least 5 characters."}
        </small>
      </div>
    </Dialog>
  );
}
