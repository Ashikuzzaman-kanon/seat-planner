"use client";

import { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { createSubscription, updateSubscription } from "@/lib/subscriptions";

const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What the server would make of a name, shown as the placeholder for the code. */
const codeFrom = (name) =>
  name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/, "") || "subscription";

/**
 * Create a subscription, or rename and re-describe one.
 *
 * The code is asked for once and shown read-only afterwards: outside callers
 * check for a subscription by its code, so it must outlive any renaming.
 */
export default function SubscriptionEditor({ subscription, visible, onHide, onSaved, notify }) {
  const editing = Boolean(subscription?.id);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setName(subscription?.name || "");
    setDescription(subscription?.description || "");
    setCode("");
    setError(null);
  }, [visible, subscription]);

  const cleanName = name.trim();
  const cleanCode = code.trim();
  const codeOk = !cleanCode || CODE.test(cleanCode);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = editing
        ? await updateSubscription(subscription.id, { name: cleanName, description: description.trim() || null })
        : await createSubscription({ name: cleanName, description: description.trim(), code: cleanCode });
      notify("success", editing ? "Saved" : "Created", `${saved.name} — code ${saved.code}`);
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      header={editing ? `Edit ${subscription.name}` : "New subscription"}
      visible={visible}
      onHide={() => (busy ? null : onHide())}
      dismissableMask={!busy}
      draggable={false}
      className="sub-dialog"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (cleanName && codeOk) save();
        }}
      >
        <div className="sub-field">
          <label htmlFor="sub-name">Name</label>
          <InputText
            id="sub-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoFocus
            placeholder="Premium"
          />
        </div>

        <div className="sub-field">
          <label htmlFor="sub-description">
            Description <span className="sub-field__optional">optional</span>
          </label>
          <InputTextarea
            id="sub-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            autoResize
            maxLength={500}
            placeholder="What people see before they ask for it"
          />
        </div>

        <div className="sub-field">
          <label htmlFor="sub-code">
            Code {!editing && <span className="sub-field__optional">optional</span>}
          </label>
          {editing ? (
            <code className="sub-code sub-code--block">{subscription.code}</code>
          ) : (
            <InputText
              id="sub-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase())}
              maxLength={40}
              placeholder={cleanName ? codeFrom(cleanName) : "premium"}
              className={codeOk ? "" : "p-invalid"}
              aria-describedby="sub-code-hint"
            />
          )}
          <small id="sub-code-hint" className={`sub-field__hint${codeOk ? "" : " is-error"}`}>
            {codeOk
              ? editing
                ? "How outside callers name this subscription. It never changes, whatever the name becomes."
                : "How outside callers name this subscription. Left empty, it is made from the name. It cannot be changed later."
              : "Lowercase letters, digits and single hyphens only."}
          </small>
        </div>

        {error && (
          <p className="sub-dialog__error" role="alert">
            {error}
          </p>
        )}

        <div className="sub-dialog__actions">
          <Button type="button" label="Cancel" text onClick={onHide} disabled={busy} />
          <Button
            type="submit"
            label={editing ? "Save" : "Create"}
            icon="pi pi-check"
            loading={busy}
            disabled={!cleanName || !codeOk}
          />
        </div>
      </form>
    </Dialog>
  );
}
