"use client";

import { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputTextarea } from "primereact/inputtextarea";

/**
 * "Are you sure?", with room to say why.
 *
 * Every ending here — a request declined, a subscription cancelled — is told
 * to the person it happened to, and a reason is the difference between a
 * notification that explains and one that only alarms. `reasonLabel` left out
 * makes it a plain confirmation.
 */
export default function ReasonDialog({
  visible,
  header,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmIcon = "pi pi-check",
  severity,
  reasonLabel,
  reasonPlaceholder,
  children,
  canConfirm = true,
  onConfirm,
  onHide,
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // A fresh question each time it opens.
  useEffect(() => {
    if (visible) setReason("");
  }, [visible]);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      header={header}
      visible={visible}
      onHide={() => (busy ? null : onHide())}
      dismissableMask={!busy}
      draggable={false}
      className="sub-dialog"
    >
      {message && <p className="sub-dialog__message">{message}</p>}
      {children}

      {reasonLabel && (
        <div className="sub-field">
          <label htmlFor="sub-reason">{reasonLabel}</label>
          <InputTextarea
            id="sub-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoResize
            maxLength={500}
            placeholder={reasonPlaceholder}
          />
        </div>
      )}

      <div className="sub-dialog__actions">
        <Button label={cancelLabel} text onClick={onHide} disabled={busy} />
        <Button
          label={confirmLabel}
          icon={confirmIcon}
          severity={severity}
          onClick={confirm}
          loading={busy}
          disabled={!canConfirm}
        />
      </div>
    </Dialog>
  );
}
