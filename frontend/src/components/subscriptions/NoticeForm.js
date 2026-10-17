"use client";

import { useEffect, useState } from "react";
import { Button } from "primereact/button";
import { Checkbox } from "primereact/checkbox";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Tag } from "primereact/tag";
import PersonLink from "@/components/people/PersonLink";
import { cleanVersion, sendNotice } from "@/lib/subscriptions";

const KINDS = [
  { value: "released", label: "New version out", icon: "pi pi-sparkles" },
  { value: "retiring", label: "Old version going away", icon: "pi pi-clock" },
];

const when = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" })
    : "";

/**
 * Telling a subscription's subscribers on one platform about a version of its
 * app — and what has been told already.
 *
 * The message starts from the server's words for the kind and version, and
 * follows them until the sender changes it. Everyone it reaches gets it in the
 * app; with "Email them too", by email as well.
 *
 * `offer` opens the form ready-filled — after the minimum is raised or a
 * version blocked, the subscribers on older versions are the people to tell.
 */
export default function NoticeForm({ subscription, platform, notices, offer, onSent, notify }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("released");
  const [version, setVersion] = useState("");
  const [message, setMessage] = useState("");
  const [edited, setEdited] = useState(false);
  const [email, setEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  const template = (k, v) => platform.noticeTemplates[k].replace("{version}", cleanVersion(v) || v.trim() || "…");

  // Only a new offer refills the form; the sender's own edits are left alone otherwise.
  useEffect(() => {
    if (!offer) return;
    setOpen(true);
    setKind(offer.kind);
    setVersion(offer.version);
    setMessage(offer.message || template(offer.kind, offer.version));
    setEdited(Boolean(offer.message));
    setEmail(false);
  }, [offer]);

  // Until the sender writes their own, the words follow the kind and version.
  const pick = (nextKind, nextVersion) => {
    setKind(nextKind);
    setVersion(nextVersion);
    if (!edited) setMessage(template(nextKind, nextVersion));
  };

  const start = () => {
    setOpen(true);
    setEdited(false);
    setEmail(false);
    setMessage(template(kind, version));
  };

  // Closing throws the draft away, offered or typed: the next notice starts clean.
  const close = () => {
    setOpen(false);
    setKind("released");
    setVersion("");
    setMessage("");
    setEdited(false);
    setEmail(false);
  };

  const versionOk = Boolean(cleanVersion(version));
  const ready = versionOk && message.trim() && platform.reach > 0;
  const field = `${subscription.id}-${platform.id}`;

  const send = async () => {
    setBusy(true);
    try {
      const sent = await sendNotice(subscription.id, platform.id, { kind, version: version.trim(), message: message.trim(), email });
      notify(
        "success",
        `Sent to ${sent.recipients} subscriber${sent.recipients === 1 ? "" : "s"}`,
        email ? "In the app now; the emails go out in the next minute or so." : "In the app."
      );
      close();
      await onSent();
    } catch (err) {
      notify("error", "Could not send it", err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sub-versions__section" aria-label={`Notices to ${platform.name} subscribers`}>
      <div className="sub-notice__head">
        <h3 className="sub-request__label">Tell subscribers</h3>
        {!open && (
          <Button
            label="Send a notice"
            icon="pi pi-megaphone"
            size="small"
            outlined
            onClick={start}
            disabled={platform.reach === 0}
          />
        )}
      </div>
      <p className="sub-versions__none">
        {platform.reach
          ? `A notice reaches ${platform.reach} current subscriber${platform.reach === 1 ? "" : "s"} with a ${platform.name} device.`
          : `No current subscriber has a ${platform.name} device yet, so there is nobody to tell.`}
      </p>

      {open && (
        <form
          className="sub-notice"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !busy) send();
          }}
        >
          <div className="sub-notice__kinds" role="radiogroup" aria-label="What the notice is about">
            {KINDS.map((k) => (
              <Button
                key={k.value}
                type="button"
                label={k.label}
                icon={k.icon}
                size="small"
                outlined={kind !== k.value}
                role="radio"
                aria-checked={kind === k.value}
                onClick={() => pick(k.value, version)}
              />
            ))}
          </div>
          <div className="sub-field">
            <label htmlFor={`notice-version-${field}`}>Version</label>
            <InputText
              id={`notice-version-${field}`}
              value={version}
              onChange={(e) => pick(kind, e.target.value)}
              maxLength={40}
              placeholder="2.0.1"
              className={version.trim() && !versionOk ? "p-invalid" : ""}
            />
          </div>
          <div className="sub-field">
            <label htmlFor={`notice-message-${field}`}>Message</label>
            <InputTextarea
              id={`notice-message-${field}`}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setEdited(true);
              }}
              rows={3}
              autoResize
              maxLength={1000}
            />
            <small className="sub-field__hint">What subscribers read, in the app and in the email. The app&rsquo;s link is added to the email when there is one.</small>
          </div>
          <div className="sub-notice__email">
            <Checkbox inputId={`notice-email-${field}`} checked={email} onChange={(e) => setEmail(e.checked)} />
            <label htmlFor={`notice-email-${field}`}>Email them too</label>
          </div>
          <div className="sub-notice__actions">
            <Button type="button" label="Cancel" text size="small" onClick={close} disabled={busy} />
            <Button
              type="submit"
              label={`Send to ${platform.reach} subscriber${platform.reach === 1 ? "" : "s"}`}
              icon="pi pi-send"
              size="small"
              loading={busy}
              disabled={!ready}
            />
          </div>
        </form>
      )}

      {notices.length > 0 && (
        <ul className="sub-notice__history">
          {notices.map((n) => (
            <li key={n.id}>
              <div className="sub-notice__line">
                <Tag value={n.kind === "released" ? "New version" : "Going away"} severity={n.kind === "released" ? "info" : "warning"} />
                <code className="sub-code">{n.version}</code>
                <span>
                  to {n.recipients}
                  {n.emailed ? ", by email too" : ", in the app"}
                </span>
                <small>
                  {when(n.sentAt)}
                  {n.sentBy && (
                    <>
                      {" · "}
                      <PersonLink id={n.sentBy.id} name={n.sentBy.fullName} />
                    </>
                  )}
                </small>
              </div>
              <p>{n.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
