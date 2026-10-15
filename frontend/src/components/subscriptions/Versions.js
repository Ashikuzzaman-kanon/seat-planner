"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "primereact/button";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import PersonLink from "@/components/people/PersonLink";
import { tip } from "@/components/ui/tip";
import {
  blockVersion,
  cleanVersion,
  compareVersions,
  fetchVersionPolicies,
  setVersionPolicy,
  unblockVersion,
} from "@/lib/subscriptions";

const when = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" })
    : "";

/** Whether one version would be turned away under a platform's rules as they stand. */
function refusedBy(platform, version) {
  if (!version) return platform.versionRequired ? "No version sent" : null;
  if (platform.minVersion && compareVersions(version, platform.minVersion) < 0) return "Older than the minimum";
  if (platform.blocked.some((b) => compareVersions(b.version, version) === 0)) return "Blocked";
  return null;
}

/**
 * Which versions of each platform's app may make the subscription check.
 *
 * Per platform: whether a check must say its version at all, the oldest one
 * still accepted, and single versions turned away whatever the minimum. Beside
 * them, the versions devices last checked in with — so a minimum is raised
 * knowing who it will turn away. All of it is off until someone turns it on;
 * a platform with no rules lets every check through, as before.
 */
export default function Versions({ notify }) {
  const [platforms, setPlatforms] = useState(null);

  const load = useCallback(async () => {
    try {
      setPlatforms(await fetchVersionPolicies());
    } catch (err) {
      notify("error", "Could not load the version rules", err.message);
      setPlatforms([]);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  if (!platforms) {
    return (
      <div className="sub-centre">
        <ProgressSpinner style={{ width: 36, height: 36 }} />
      </div>
    );
  }
  if (!platforms.length) {
    return (
      <div className="card sub-empty">
        <i className="pi pi-desktop" aria-hidden="true" />
        <p>There are no platforms yet. Add one on the Platforms tab first.</p>
      </div>
    );
  }

  return (
    <ul className="sub-queue">
      {platforms.map((platform) => (
        <PlatformVersions key={platform.id} platform={platform} reload={load} notify={notify} />
      ))}
    </ul>
  );
}

function PlatformVersions({ platform, reload, notify }) {
  const [minimum, setMinimum] = useState(platform.minVersion || "");
  const [version, setVersion] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null); // "required" | "minimum" | "block" | blocked id

  // A reload brings the minimum as saved.
  useEffect(() => setMinimum(platform.minVersion || ""), [platform.minVersion]);

  const run = async (what, work, said) => {
    setBusy(what);
    try {
      await work();
      notify("success", said, platform.name);
      await reload();
      return true;
    } catch (err) {
      notify("error", "Could not change it", err.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const typedMinimum = minimum.trim();
  const cleanMinimum = cleanVersion(typedMinimum);
  const minimumOk = !typedMinimum || Boolean(cleanMinimum);
  // "2" and "2.0" are one version, so typing one over the other is no change.
  const minimumChanged = typedMinimum
    ? !cleanMinimum || !platform.minVersion || compareVersions(cleanMinimum, platform.minVersion) !== 0
    : Boolean(platform.minVersion);
  const typedVersion = version.trim();
  const versionOk = !typedVersion || Boolean(cleanVersion(typedVersion));

  const saveMinimum = () =>
    run("minimum", () => setVersionPolicy(platform.id, { minVersion: typedMinimum || null }), typedMinimum ? `Minimum is now ${cleanVersion(typedMinimum)}` : "Minimum removed");

  const block = async () => {
    const done = await run("block", () => blockVersion(platform.id, { version: typedVersion, note: note.trim() }), `Version ${cleanVersion(typedVersion)} blocked`);
    if (done) {
      setVersion("");
      setNote("");
    }
  };

  const turnedAway = platform.inUse.filter((v) => refusedBy(platform, v.version)).reduce((n, v) => n + v.devices, 0);

  return (
    <li className="card sub-versions">
      <div className="sub-versions__head">
        <div className="sub-request__who">
          <strong>{platform.name}</strong>
          <span>
            Callers send <code className="sub-code">{platform.value}</code>
          </span>
        </div>
        {!platform.isActive && <Tag value="Switched off" severity="secondary" />}
      </div>

      <div className="sub-versions__rules">
        <div className="sub-versions__rule">
          <InputSwitch
            inputId={`required-${platform.id}`}
            checked={platform.versionRequired}
            disabled={busy === "required"}
            onChange={(e) =>
              run(
                "required",
                () => setVersionPolicy(platform.id, { versionRequired: e.value }),
                e.value ? "A version is now required" : "A version is no longer required"
              )
            }
          />
          <label htmlFor={`required-${platform.id}`}>
            <strong>Require a version</strong>
            <small>A check that does not say its version is refused: “A version is required”.</small>
          </label>
        </div>

        <form
          className="sub-versions__minimum"
          onSubmit={(e) => {
            e.preventDefault();
            if (minimumOk && minimumChanged) saveMinimum();
          }}
        >
          <div className="sub-field">
            <label htmlFor={`minimum-${platform.id}`}>
              Oldest version accepted <span className="sub-field__optional">optional</span>
            </label>
            <div className="sub-dev__note-form">
              <InputText
                id={`minimum-${platform.id}`}
                value={minimum}
                onChange={(e) => setMinimum(e.target.value)}
                maxLength={40}
                placeholder="No minimum"
                className={minimumOk ? "" : "p-invalid"}
                aria-describedby={`minimum-hint-${platform.id}`}
              />
              <Button type="submit" label="Save" size="small" loading={busy === "minimum"} disabled={!minimumOk || !minimumChanged} />
            </div>
            <small id={`minimum-hint-${platform.id}`} className={`sub-field__hint${minimumOk ? "" : " is-error"}`}>
              {minimumOk
                ? "Anything older is refused: “This version is no longer supported. Please update.” Leave it empty for no minimum."
                : "Numbers and dots, such as 1.4.2"}
            </small>
          </div>
        </form>
      </div>

      <section className="sub-versions__section" aria-label={`Blocked versions of ${platform.name}`}>
        <h3 className="sub-request__label">Blocked versions</h3>
        {platform.blocked.length ? (
          <ul className="sub-versions__blocked">
            {platform.blocked.map((b) => (
              <li key={b.id}>
                <div>
                  <code className="sub-code">{b.version}</code>
                  {b.note && <span className="sub-versions__note">{b.note}</span>}
                  <small>
                    {when(b.createdAt)}
                    {b.createdBy && (
                      <>
                        {" · "}
                        <PersonLink id={b.createdBy.id} name={b.createdBy.fullName} />
                      </>
                    )}
                  </small>
                </div>
                <Button
                  icon="pi pi-times"
                  size="small"
                  text
                  rounded
                  loading={busy === b.id}
                  onClick={() => run(b.id, () => unblockVersion(platform.id, b.id), `Version ${b.version} unblocked`)}
                  {...tip("Unblock — let it check again")}
                  aria-label={`Unblock ${b.version}`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="sub-versions__none">None. Block one that has a fault, even if it is newer than the minimum.</p>
        )}
        <form
          className="sub-versions__block-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (typedVersion && versionOk) block();
          }}
        >
          <InputText
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            maxLength={40}
            placeholder="1.4.2"
            aria-label="Version to block"
            className={versionOk ? "" : "p-invalid"}
          />
          <InputText value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Why (optional)" aria-label="Why it is blocked" />
          <Button type="submit" label="Block" icon="pi pi-ban" size="small" severity="danger" outlined loading={busy === "block"} disabled={!typedVersion || !versionOk} />
        </form>
      </section>

      <section className="sub-versions__section" aria-label={`Versions of ${platform.name} in use`}>
        <h3 className="sub-request__label">In use</h3>
        {platform.inUse.length ? (
          <>
            <ul className="sub-versions__inuse">
              {platform.inUse.map((v) => {
                const refused = refusedBy(platform, v.version);
                return (
                  <li key={v.version || "none"}>
                    {v.version ? <code className="sub-code">{v.version}</code> : <span className="sub-versions__none">Not said</span>}
                    <span>
                      {v.devices} device{v.devices === 1 ? "" : "s"}
                    </span>
                    <small>last seen {when(v.lastSeenAt)}</small>
                    {refused && <Tag value={refused} severity="danger" />}
                  </li>
                );
              })}
            </ul>
            {turnedAway > 0 && (
              <p className="sub-field__hint is-error">
                {turnedAway} device{turnedAway === 1 ? "" : "s"} last checked in with a version these rules refuse.
              </p>
            )}
          </>
        ) : (
          <p className="sub-versions__none">No device has checked in on this platform yet.</p>
        )}
      </section>
    </li>
  );
}
