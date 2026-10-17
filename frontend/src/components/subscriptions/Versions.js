"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "primereact/button";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import PersonLink from "@/components/people/PersonLink";
import NoticeForm from "./NoticeForm";
import Select from "@/components/ui/Select";
import { tip } from "@/components/ui/tip";
import {
  blockVersion,
  cleanVersion,
  compareVersions,
  fetchVersionPolicies,
  setAppLink,
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
 * Where the subscription's app is got from. Subscribers whose subscription is
 * running see a button that goes here.
 */
function AppLinkField({ subscription, onSaved, notify }) {
  const saved = subscription.appUrl || "";
  const [link, setLink] = useState(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => setLink(saved), [saved]);

  const typed = link.trim();
  const looksRight = !typed || /^https:\/\/[^\s/]+\.[^\s]+$/i.test(typed);
  const changed = typed !== saved;

  const save = async () => {
    setBusy(true);
    try {
      const appUrl = await setAppLink(subscription.id, typed);
      notify("success", appUrl ? "App link saved" : "App link removed", subscription.name);
      await onSaved();
    } catch (err) {
      notify("error", "Could not save the link", err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="sub-field sub-versions-pick__link"
      onSubmit={(e) => {
        e.preventDefault();
        if (looksRight && changed) save();
      }}
    >
      <label htmlFor="versions-app-link">
        App link <span className="sub-field__optional">optional</span>
      </label>
      <div className="sub-dev__note-form">
        <InputText
          id="versions-app-link"
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          maxLength={500}
          placeholder="https://…"
          className={looksRight ? "" : "p-invalid"}
          aria-describedby="versions-app-link-hint"
        />
        <Button type="submit" label={typed || !saved ? "Save" : "Remove"} size="small" loading={busy} disabled={!looksRight || !changed} />
      </div>
      <small id="versions-app-link-hint" className={`sub-field__hint${looksRight ? "" : " is-error"}`}>
        {looksRight
          ? "Subscribers whose subscription is running get an Open the app button that goes here."
          : "A full https:// address, such as https://example.com/app"}
      </small>
    </form>
  );
}

/**
 * Which versions of each platform's app a subscription accepts on the check.
 *
 * One subscription at a time, chosen at the top: for each platform, whether a
 * check must say its version at all, the oldest one still accepted, and single
 * versions turned away whatever the minimum. Beside them, the versions its
 * subscribers' devices last checked in with — so a minimum is raised knowing
 * who it will turn away. A subscription starts with no rules, and accepts any
 * version or none.
 *
 * `chosenId` is the subscription shown; `onChoose` changes it, so the page can
 * keep it in the address.
 */
export default function Versions({ subscriptions, chosenId, onChoose, notify }) {
  const [rules, setRules] = useState(null);
  const chosen = subscriptions.find((s) => s.id === chosenId) || subscriptions[0] || null;
  const shownId = chosen?.id ?? null;

  const load = useCallback(async () => {
    if (!shownId) return;
    try {
      setRules(await fetchVersionPolicies(shownId));
    } catch (err) {
      notify("error", "Could not load the version rules", err.message);
      setRules({ platforms: [] });
    }
  }, [shownId, notify]);

  useEffect(() => {
    setRules(null);
    load();
  }, [load]);

  if (!chosen) {
    return (
      <div className="card sub-empty">
        <i className="pi pi-tag" aria-hidden="true" />
        <p>There are no subscriptions yet. Version rules belong to a subscription, so create one first.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card sub-versions-pick">
        <div className="sub-field">
          <label htmlFor="versions-subscription">Subscription</label>
          <Select
            inputId="versions-subscription"
            value={chosen.id}
            options={subscriptions.map((s) => ({ label: s.name, value: s.id }))}
            onChange={(e) => onChoose(e.value)}
            required
          />
        </div>
        <p className="sub-field__hint">
          Each subscription has its own rules for each platform. A check is answered subscription by subscription: one that
          turns the app&rsquo;s version away says so on its own entry, and the rest are answered as usual.
        </p>
        {rules?.subscription && <AppLinkField subscription={rules.subscription} onSaved={load} notify={notify} />}
      </div>

      {!rules ? (
        <div className="sub-centre">
          <ProgressSpinner style={{ width: 36, height: 36 }} />
        </div>
      ) : !rules.platforms.length ? (
        <div className="card sub-empty">
          <i className="pi pi-desktop" aria-hidden="true" />
          <p>There are no platforms yet. Add one on the Platforms tab first.</p>
        </div>
      ) : (
        <ul className="sub-queue">
          {rules.platforms.map((platform) => (
            <PlatformVersions
              key={`${chosen.id}-${platform.id}`}
              subscription={chosen}
              platform={platform}
              notices={(rules.notices || []).filter((n) => n.platformId === platform.id)}
              reload={load}
              notify={notify}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function PlatformVersions({ subscription, platform, notices, reload, notify }) {
  const [minimum, setMinimum] = useState(platform.minVersion || "");
  const [version, setVersion] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null); // "required" | "minimum" | "block" | blocked id
  // A notice offered after a change that turns older apps away.
  const [offer, setOffer] = useState(null);

  // A reload brings the minimum as saved.
  useEffect(() => setMinimum(platform.minVersion || ""), [platform.minVersion]);

  const run = async (what, work, said) => {
    setBusy(what);
    try {
      await work();
      notify("success", said, `${subscription.name} · ${platform.name}`);
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

  const saveMinimum = async () => {
    const raised = cleanMinimum && (!platform.minVersion || compareVersions(cleanMinimum, platform.minVersion) > 0);
    const done = await run(
      "minimum",
      () => setVersionPolicy(subscription.id, platform.id, { minVersion: typedMinimum || null }),
      typedMinimum ? `Minimum is now ${cleanMinimum}` : "Minimum removed"
    );
    if (done && raised) {
      setOffer({
        kind: "retiring",
        version: cleanMinimum,
        message:
          `Versions of the ${subscription.name} app for ${platform.name} older than ${cleanMinimum} are going away and will ` +
          "stop working. Please update to the latest version.",
      });
    }
  };

  const block = async () => {
    const blocked = cleanVersion(typedVersion);
    const done = await run(
      "block",
      () => blockVersion(subscription.id, platform.id, { version: typedVersion, note: note.trim() }),
      `Version ${blocked} blocked`
    );
    if (done) {
      setVersion("");
      setNote("");
      setOffer({ kind: "retiring", version: blocked });
    }
  };

  const turnedAway = platform.inUse.filter((v) => refusedBy(platform, v.version)).reduce((n, v) => n + v.devices, 0);
  const field = `${subscription.id}-${platform.id}`;

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
            inputId={`required-${field}`}
            checked={platform.versionRequired}
            disabled={busy === "required"}
            onChange={(e) =>
              run(
                "required",
                () => setVersionPolicy(subscription.id, platform.id, { versionRequired: e.value }),
                e.value ? "A version is now required" : "A version is no longer required"
              )
            }
          />
          <label htmlFor={`required-${field}`}>
            <strong>Require a version</strong>
            <small>A check that does not say its version is told, for this subscription: “A version is required”.</small>
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
            <label htmlFor={`minimum-${field}`}>
              Oldest version accepted <span className="sub-field__optional">optional</span>
            </label>
            <div className="sub-dev__note-form">
              <InputText
                id={`minimum-${field}`}
                value={minimum}
                onChange={(e) => setMinimum(e.target.value)}
                maxLength={40}
                placeholder="No minimum"
                className={minimumOk ? "" : "p-invalid"}
                aria-describedby={`minimum-hint-${field}`}
              />
              <Button type="submit" label="Save" size="small" loading={busy === "minimum"} disabled={!minimumOk || !minimumChanged} />
            </div>
            <small id={`minimum-hint-${field}`} className={`sub-field__hint${minimumOk ? "" : " is-error"}`}>
              {minimumOk
                ? "Anything older is told, for this subscription: “This version is no longer supported. Please update.” Leave it empty for no minimum."
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
                  onClick={() => run(b.id, () => unblockVersion(subscription.id, platform.id, b.id), `Version ${b.version} unblocked`)}
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

      <NoticeForm subscription={subscription} platform={platform} notices={notices} offer={offer} onSent={reload} notify={notify} />

      <section className="sub-versions__section" aria-label={`Versions of ${platform.name} in use`}>
        <h3 className="sub-request__label">In use by its subscribers</h3>
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
          <p className="sub-versions__none">No subscriber&rsquo;s device has checked in on this platform yet.</p>
        )}
      </section>
    </li>
  );
}
