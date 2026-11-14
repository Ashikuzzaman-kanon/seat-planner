"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { ProgressSpinner } from "primereact/progressspinner";
import { Tag } from "primereact/tag";
import DeviceCounts from "./DeviceCounts";
import { tip } from "@/components/ui/tip";
import {
  amendSubscription,
  countsOf,
  deleteDevice,
  describeDevices,
  fetchUserDevices,
  REFUSAL_WORDS,
  sameCounts,
  totalOf,
  updateDevice,
} from "@/lib/subscriptions";
import { timeAgo } from "@/lib/notifications";

const day = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" })
    : "";

/**
 * One subscriber's devices, for whoever reviews subscriptions.
 *
 * Three things, top to bottom: how many devices this subscription allows
 * (changeable while it runs), the devices on the account, and the checks that
 * were turned away — with the reason the caller was never given.
 *
 * Devices belong to the account, not to one subscription, so the list is the
 * same whichever of a person's rows it was opened from.
 */
export default function DevicesDialog({ member, platforms, maxDevices, onHide, onChanged, notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [allowed, setAllowed] = useState({}); // the counts as saved
  const [counts, setCounts] = useState({}); // the counts as edited
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [noting, setNoting] = useState(null); // { id, text }
  const [removing, setRemoving] = useState(null); // device id

  const userId = member?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setData(await fetchUserDevices(userId));
    } catch (err) {
      notify("error", "Could not load the devices", err.message);
    } finally {
      setLoading(false);
    }
  }, [userId, notify]);

  // A fresh look each time it opens on someone.
  useEffect(() => {
    if (!member) return;
    const saved = countsOf(member.devices, platforms);
    setAllowed(saved);
    setCounts(saved);
    setData(null);
    setNoting(null);
    setRemoving(null);
    load();
    // The row it was opened on is the trigger, not every re-render of the table.
  }, [member?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each device's place among the unblocked ones of its platform, in arrival order.
  const places = useMemo(() => {
    const seen = {};
    const map = new Map();
    for (const device of data?.devices || []) {
      if (device.isBlocked) continue;
      seen[device.platformId] = (seen[device.platformId] || 0) + 1;
      map.set(device.id, seen[device.platformId]);
    }
    return map;
  }, [data]);
  const mostOn = useMemo(() => Object.fromEntries((data?.usage || []).map((u) => [u.platformId, u.allowed])), [data]);

  const saveCounts = async () => {
    setSaving(true);
    try {
      const done = await amendSubscription(member.id, { devices: counts });
      const saved = countsOf(done.devices, platforms);
      setAllowed(saved);
      setCounts(saved);
      notify("success", "Device counts changed", `${member.user.fullName} — now ${describeDevices(done.devices)}`);
      await Promise.all([load(), onChanged?.()]);
    } catch (err) {
      notify("error", "Could not change the counts", err.message);
    } finally {
      setSaving(false);
    }
  };

  const act = async (device, work, done) => {
    setBusyId(device.id);
    try {
      await work();
      done?.();
      await load();
    } catch (err) {
      notify("error", "That did not work", err.message);
    } finally {
      setBusyId(null);
    }
  };

  const saveNote = (device) =>
    act(
      device,
      () => updateDevice(device.id, { note: noting.text.trim() }),
      () => setNoting(null)
    );
  const toggleBlock = (device) =>
    act(
      device,
      () => updateDevice(device.id, { isBlocked: !device.isBlocked }),
      () =>
        notify(
          "info",
          device.isBlocked ? "Unblocked" : "Blocked",
          device.isBlocked ? "It has its place in the order back." : "It is no longer valid, and its place is free."
        )
    );
  const remove = (device) =>
    act(
      device,
      () => deleteDevice(device.id),
      () => {
        setRemoving(null);
        notify("info", "Device removed", "Its place is free.");
      }
    );

  const changed = !sameCounts(counts, allowed, platforms);

  return (
    <Dialog
      header={member ? `Devices — ${member.user.fullName}` : ""}
      visible={Boolean(member)}
      onHide={onHide}
      dismissableMask
      draggable={false}
      className="sub-dialog sub-dialog--wide"
    >
      {member && (
        <>
          <p className="sub-dialog__message">{member.user.email}</p>

          <section className="sub-dev-section" aria-labelledby="dev-limits-title">
            <h3 id="dev-limits-title">What {member.subscription.name} allows</h3>
            {member.valid ? (
              <>
                <DeviceCounts platforms={platforms} value={counts} onChange={setCounts} max={maxDevices} id="limit-devices" />
                <p className="sub-dev-section__about">
                  Lowering a count removes no device: the ones that signed in first keep their places, and the later ones stop
                  being valid.
                </p>
                <div className="sub-dialog__actions sub-dialog__actions--start">
                  <Button
                    label="Save counts"
                    icon="pi pi-check"
                    size="small"
                    loading={saving}
                    disabled={!changed || totalOf(counts) === 0}
                    onClick={saveCounts}
                  />
                  {changed && <Button label="Undo" size="small" text onClick={() => setCounts(allowed)} disabled={saving} />}
                </div>
              </>
            ) : (
              <p className="sub-dev-section__about">
                {describeDevices(member.devices)} — it is not running, so the counts cannot be changed.
              </p>
            )}
          </section>

          <section className="sub-dev-section" aria-labelledby="dev-list-title">
            <h3 id="dev-list-title">On this account</h3>
            {loading && !data ? (
              <div className="sub-centre sub-centre--tight">
                <ProgressSpinner style={{ width: 28, height: 28 }} />
              </div>
            ) : (
              <>
                {data?.usage.length > 0 && (
                  <div className="sub-usage">
                    {data.usage.map((u) => (
                      <span key={u.platformId} className={`sub-usage__item${u.used >= u.allowed ? " is-full" : ""}`}>
                        <strong>
                          {u.used} of {u.allowed}
                        </strong>
                        {u.name}
                        {!u.isActive && " (off)"}
                      </span>
                    ))}
                  </div>
                )}

                {!data?.devices.length ? (
                  <p className="sub-muted">No device has signed in on this account yet.</p>
                ) : (
                  <ul className="sub-dev-list">
                    {data.devices.map((device) => {
                      const place = places.get(device.id);
                      const beyond = place && place > (mostOn[device.platformId] ?? 0);
                      const busy = busyId === device.id;

                      return (
                        <li key={device.id} className={`sub-dev${device.isBlocked ? " is-blocked" : ""}`}>
                          <div className="sub-dev__main">
                            <div className="sub-dev__head">
                              <strong>{device.platform?.name}</strong>
                              {device.isBlocked ? (
                                <Tag value="Blocked" severity="danger" />
                              ) : beyond ? (
                                <Tag value={`Place ${place} — beyond the limit`} severity="warning" />
                              ) : (
                                <Tag value={`Place ${place}`} severity="success" />
                              )}
                            </div>
                            <code className="sub-device-id">{device.deviceId}</code>
                            <small>
                              First seen {day(device.firstSeenAt)} · last seen {timeAgo(device.lastSeenAt)} · {device.checks} check
                              {device.checks === 1 ? "" : "s"}
                              {device.appVersion && ` · version ${device.appVersion}`}
                            </small>

                            {noting?.id === device.id ? (
                              <form
                                className="sub-dev__note-form"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  saveNote(device);
                                }}
                              >
                                <InputText
                                  value={noting.text}
                                  onChange={(e) => setNoting({ id: device.id, text: e.target.value })}
                                  maxLength={200}
                                  autoFocus
                                  placeholder="Whose it is, or what it is"
                                  aria-label="Note"
                                />
                                <Button type="submit" label="Save" size="small" loading={busy} />
                                <Button type="button" label="Cancel" size="small" text onClick={() => setNoting(null)} disabled={busy} />
                              </form>
                            ) : (
                              device.note && <p className="sub-dev__note">“{device.note}”</p>
                            )}

                            {removing === device.id && (
                              <div className="sub-dev__confirm" role="alert">
                                <span>
                                  Remove it? Its place is free at once — and it may take one again the next time it signs in.
                                  To keep it out, block it instead.
                                </span>
                                <span className="sub-dev__confirm-actions">
                                  <Button label="Remove" size="small" severity="danger" loading={busy} onClick={() => remove(device)} />
                                  <Button label="Keep it" size="small" text onClick={() => setRemoving(null)} disabled={busy} />
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="sub-dev__actions">
                            <Button
                              icon="pi pi-pencil"
                              size="small"
                              text
                              rounded
                              onClick={() => setNoting({ id: device.id, text: device.note || "" })}
                              {...tip(device.note ? "Change the note" : "Add a note")}
                            />
                            <Button
                              icon={device.isBlocked ? "pi pi-unlock" : "pi pi-ban"}
                              size="small"
                              text
                              rounded
                              severity={device.isBlocked ? undefined : "warning"}
                              loading={busy && removing !== device.id && noting?.id !== device.id}
                              onClick={() => toggleBlock(device)}
                              {...tip(device.isBlocked ? "Unblock" : "Block this device")}
                            />
                            <Button
                              icon="pi pi-trash"
                              size="small"
                              text
                              rounded
                              severity="danger"
                              onClick={() => setRemoving(device.id)}
                              {...tip("Remove from the account")}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="sub-dev-section" aria-labelledby="dev-refused-title">
            <h3 id="dev-refused-title">Turned away</h3>
            <p className="sub-dev-section__about">
              Checks that were answered “not valid” because of the device. The caller was told nothing more than that; this
              is why.
            </p>
            {!data?.refusals?.length ? (
              <p className="sub-muted">{data ? "No check has been turned away." : ""}</p>
            ) : (
              <ul className="sub-refusals">
                {data.refusals.map((refusal) => (
                  <li key={refusal.id}>
                    <span className="sub-refusals__why">
                      <strong>{REFUSAL_WORDS[refusal.reason] || refusal.reason}</strong>
                      <small>
                        {refusal.platform || "no platform"} ·{" "}
                        {refusal.deviceId ? <code className="sub-device-id">{refusal.deviceId}</code> : "no device id"}
                      </small>
                    </span>
                    <span className="sub-refusals__when">
                      <strong>{refusal.attempts}×</strong>
                      <small title={new Date(refusal.lastAt).toLocaleString("en-GB")}>last {timeAgo(refusal.lastAt)}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Dialog>
  );
}
