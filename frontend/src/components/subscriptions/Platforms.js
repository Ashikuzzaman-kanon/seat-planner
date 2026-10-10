"use client";

import { useState } from "react";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import ReasonDialog from "./ReasonDialog";
import { tip } from "@/components/ui/tip";
import { createPlatform, deletePlatform, updatePlatform } from "@/lib/subscriptions";

const VALUE = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

/**
 * The platforms a subscription can be used on — Windows, Android, and whatever
 * comes next.
 *
 * Each is its own count on every subscription. A platform's value is what an
 * outside caller sends as `platform`, so like a subscription's code it is set
 * once; the name beside it can change freely.
 */
export default function Platforms({ platforms, onChanged, notify }) {
  const [value, setValue] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [renaming, setRenaming] = useState(null); // { id, text }
  const [deleting, setDeleting] = useState(null);

  const cleanValue = value.trim();
  const valueOk = !cleanValue || VALUE.test(cleanValue);

  const add = async () => {
    setAdding(true);
    try {
      const made = await createPlatform({ value: cleanValue, name: name.trim() });
      notify("success", "Platform created", `${made.name} — callers send “${made.value}”`);
      setValue("");
      setName("");
      await onChanged();
    } catch (err) {
      notify("error", "Could not create it", err.message);
    } finally {
      setAdding(false);
    }
  };

  const change = async (platform, changes, said) => {
    setBusyId(platform.id);
    try {
      await updatePlatform(platform.id, changes);
      if (said) notify("info", said, platform.name);
      setRenaming(null);
      await onChanged();
    } catch (err) {
      notify("error", "Could not change it", err.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    try {
      await deletePlatform(deleting.id);
      notify("info", "Deleted", deleting.name);
      setDeleting(null);
      await onChanged();
    } catch (err) {
      notify("error", "Could not delete it", err.message);
      setDeleting(null);
    }
  };

  return (
    <>
      <form
        className="card sub-platform-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (cleanValue && valueOk && name.trim()) add();
        }}
      >
        <div className="sub-field">
          <label htmlFor="platform-name">Name</label>
          <InputText id="platform-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="iPhone" />
        </div>
        <div className="sub-field">
          <label htmlFor="platform-value">Value</label>
          <InputText
            id="platform-value"
            value={value}
            onChange={(e) => setValue(e.target.value.toLowerCase())}
            maxLength={40}
            placeholder="ios"
            className={valueOk ? "" : "p-invalid"}
            aria-describedby="platform-value-hint"
          />
        </div>
        <Button type="submit" label="Add platform" icon="pi pi-plus" loading={adding} disabled={!cleanValue || !valueOk || !name.trim()} />
        <small id="platform-value-hint" className={`sub-field__hint sub-platform-form__hint${valueOk ? "" : " is-error"}`}>
          {valueOk
            ? "The value is what a caller sends as platform, and cannot be changed later. Subscriptions already running allow no devices on a new platform until a reviewer raises their count."
            : "Lowercase letters and digits, with single - _ or . between them."}
        </small>
      </form>

      <ul className="sub-queue">
        {platforms.map((platform) => (
          <li key={platform.id} className="card sub-platform">
            <div className="sub-request__who">
              {renaming?.id === platform.id ? (
                <form
                  className="sub-dev__note-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (renaming.text.trim()) change(platform, { name: renaming.text.trim() }, "Renamed");
                  }}
                >
                  <InputText
                    value={renaming.text}
                    onChange={(e) => setRenaming({ id: platform.id, text: e.target.value })}
                    maxLength={60}
                    autoFocus
                    aria-label="Name"
                  />
                  <Button type="submit" label="Save" size="small" loading={busyId === platform.id} disabled={!renaming.text.trim()} />
                  <Button type="button" label="Cancel" size="small" text onClick={() => setRenaming(null)} />
                </form>
              ) : (
                <strong>{platform.name}</strong>
              )}
              <span>
                Callers send <code className="sub-code">{platform.value}</code>
              </span>
            </div>
            <Tag value={platform.isActive ? "On" : "Switched off"} severity={platform.isActive ? "success" : "secondary"} />
            <div className="sub-request__actions">
              <Button
                icon="pi pi-pencil"
                size="small"
                text
                rounded
                onClick={() => setRenaming({ id: platform.id, text: platform.name })}
                {...tip("Rename")}
              />
              <Button
                icon={platform.isActive ? "pi pi-power-off" : "pi pi-play"}
                size="small"
                text
                rounded
                loading={busyId === platform.id && !renaming}
                onClick={() =>
                  change(platform, { isActive: !platform.isActive }, platform.isActive ? "Switched off" : "Switched on")
                }
                {...tip(platform.isActive ? "Switch off — no check from it is valid" : "Switch back on")}
              />
              <Button
                icon="pi pi-trash"
                size="small"
                text
                rounded
                severity="danger"
                onClick={() => setDeleting(platform)}
                {...tip("Delete")}
              />
            </div>
          </li>
        ))}
      </ul>

      <ReasonDialog
        visible={Boolean(deleting)}
        header={`Delete ${deleting?.name || ""}?`}
        message="Only a platform nothing uses can be deleted — no device on it, and no subscription allowing any. Otherwise switch it off instead."
        confirmLabel="Delete"
        confirmIcon="pi pi-trash"
        severity="danger"
        onConfirm={remove}
        onHide={() => setDeleting(null)}
      />
    </>
  );
}
