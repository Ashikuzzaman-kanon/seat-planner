"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { InputTextarea } from "primereact/inputtextarea";
import { ProgressSpinner } from "primereact/progressspinner";
import PersonLink from "./PersonLink";
import { fetchProfile, initials, liftRestriction, longDay, restrictAccount, when } from "@/lib/people";
import { roleLabel, roleSeverity } from "@/constants/roles";
import "./people.css";

/**
 * Someone's profile, opened from their name anywhere in the dashboard.
 *
 * What it holds depends on who is looking, and the server decides: anyone sees
 * the name and roles; the account itself and staff who can view users see the
 * rest. The buttons are the ones the server says will work (`can`), so a
 * button is never offered only to be refused.
 */
export default function ProfileDialog({ userId, onHide, onChanged }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [acting, setActing] = useState(null); // "restrict" | "lift"
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setProfile(await fetchProfile(userId));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [userId]);

  // A fresh look each time it opens on someone.
  useEffect(() => {
    setProfile(null);
    setError(null);
    setActing(null);
    setText("");
    setActionError(null);
    load();
  }, [load]);

  const start = (what) => {
    setActing(what);
    setText("");
    setActionError(null);
  };

  const confirm = async () => {
    setBusy(true);
    setActionError(null);
    try {
      if (acting === "restrict") await restrictAccount(userId, text.trim());
      else await liftRestriction(userId, text.trim());
      setActing(null);
      setText("");
      await load();
      onChanged?.(userId);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const p = profile;
  const full = p && !p.limited;

  const status = () => {
    if (!full) return null;
    const tags = [];
    if (p.restriction) tags.push(<Tag key="r" value="Restricted" severity="danger" icon="pi pi-lock" />);
    if (p.signInPausedUntil) tags.push(<Tag key="p" value={`Sign-in paused until ${when(p.signInPausedUntil)}`} severity="warning" />);
    if (p.buyingHold) tags.push(<Tag key="h" value="On hold from buying" severity="warning" />);
    if (!p.isVerified) tags.push(<Tag key="v" value="Email not verified" severity="secondary" />);
    if (!tags.length) tags.push(<Tag key="a" value="Active" severity="success" icon="pi pi-check" />);
    return <div className="profile-status">{tags}</div>;
  };

  return (
    <Dialog
      header={
        p ? (
          <div className="profile-head">
            <span className="profile-avatar" aria-hidden="true">
              {initials(p.fullName)}
            </span>
            <span className="profile-head__name">
              <strong>{p.fullName}</strong>
              {p.isSelf && <small>You</small>}
            </span>
          </div>
        ) : (
          "Profile"
        )
      }
      visible={Boolean(userId)}
      onHide={() => (busy ? null : onHide())}
      dismissableMask={!busy}
      draggable={false}
      className="profile-dialog"
    >
      {error ? (
        <p className="profile-error" role="alert">
          {error}
        </p>
      ) : !p ? (
        <div className="profile-loading">
          <ProgressSpinner style={{ width: 32, height: 32 }} />
        </div>
      ) : (
        <>
          <div className="profile-roles">
            {p.roles.length ? (
              p.roles.map((r) => <Tag key={r} value={roleLabel(r)} severity={roleSeverity(r)} />)
            ) : (
              <span className="profile-muted">No roles</span>
            )}
          </div>

          {!full ? (
            <p className="profile-muted profile-note">Only their name and roles are shown to you.</p>
          ) : (
            <>
              {status()}

              <dl className="profile-fields">
                <dt>Email</dt>
                <dd>{p.email}</dd>
                <dt>Date of birth</dt>
                <dd>{p.dateOfBirth ? longDay(p.dateOfBirth) : <span className="profile-muted">Not given</span>}</dd>
                <dt>National ID</dt>
                <dd>{p.nidLast4 ? <span className="profile-nid">•••• {p.nidLast4}</span> : <span className="profile-muted">Not given</span>}</dd>
                <dt>Member since</dt>
                <dd>{when(p.memberSince, { time: false })}</dd>
                <dt>Last sign-in</dt>
                <dd>{p.lastSignInAt ? when(p.lastSignInAt) : <span className="profile-muted">Not since this was recorded</span>}</dd>
              </dl>

              {p.restriction && (
                <div className="profile-restriction">
                  <strong>
                    <i className="pi pi-lock" aria-hidden="true" /> Restricted {when(p.restriction.restrictedAt)}
                    {p.restriction.restrictedBy && (
                      <>
                        {" "}
                        by <PersonLink id={p.restriction.restrictedBy.id} name={p.restriction.restrictedBy.fullName} />
                      </>
                    )}
                  </strong>
                  <span>“{p.restriction.reason}”</span>
                  <small>It cannot sign in, and the subscription check refuses it.</small>
                </div>
              )}

              {acting && (
                <div className="profile-act">
                  <label htmlFor="profile-act-text">
                    {acting === "restrict" ? "Why is it being restricted?" : "Note"}
                    {acting === "lift" && <span className="profile-muted"> optional</span>}
                  </label>
                  <InputTextarea
                    id="profile-act-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={2}
                    autoResize
                    autoFocus
                    maxLength={500}
                    placeholder={acting === "restrict" ? "Test account — not in use" : "Needed for testing this week"}
                  />
                  <small className="profile-muted">
                    {acting === "restrict"
                      ? "They are signed out everywhere at once, and cannot sign in until this is lifted."
                      : "They can sign in again straight away."}
                  </small>
                  {actionError && (
                    <p className="profile-error" role="alert">
                      {actionError}
                    </p>
                  )}
                  <div className="profile-act__buttons">
                    <Button label="Cancel" text size="small" onClick={() => setActing(null)} disabled={busy} />
                    <Button
                      label={acting === "restrict" ? "Restrict account" : "Lift restriction"}
                      icon={acting === "restrict" ? "pi pi-lock" : "pi pi-lock-open"}
                      severity={acting === "restrict" ? "danger" : undefined}
                      size="small"
                      loading={busy}
                      disabled={acting === "restrict" && !text.trim()}
                      onClick={confirm}
                    />
                  </div>
                </div>
              )}

              {!acting && (p.can.restrict || p.can.lift || p.can.editRoles) && (
                <div className="profile-actions">
                  {p.can.restrict && (
                    <Button label="Restrict account" icon="pi pi-lock" severity="danger" outlined size="small" onClick={() => start("restrict")} />
                  )}
                  {p.can.lift && <Button label="Lift restriction" icon="pi pi-lock-open" size="small" onClick={() => start("lift")} />}
                  {p.can.editRoles && (
                    <Link
                      href={`/dashboard/users?q=${encodeURIComponent(p.email)}&edit=${p.id}`}
                      className="p-button p-button-text p-button-sm profile-link-button"
                      onClick={() => onHide()}
                    >
                      <i className="pi pi-pencil" aria-hidden="true" /> Edit roles
                    </Link>
                  )}
                </div>
              )}

              {p.restrictions?.length > 0 && (
                <section className="profile-history" aria-labelledby="profile-history-title">
                  <h3 id="profile-history-title">Restrictions</h3>
                  <ul>
                    {p.restrictions.map((r) => (
                      <li key={r.id}>
                        <span>
                          Restricted {when(r.restrictedAt)}
                          {r.restrictedBy && (
                            <>
                              {" "}
                              by <PersonLink id={r.restrictedBy.id} name={r.restrictedBy.fullName} />
                            </>
                          )}
                          : “{r.reason}”
                        </span>
                        {r.liftedAt ? (
                          <small>
                            Lifted {when(r.liftedAt)}
                            {r.liftedBy && (
                              <>
                                {" "}
                                by <PersonLink id={r.liftedBy.id} name={r.liftedBy.fullName} />
                              </>
                            )}
                            {r.liftNote ? `: “${r.liftNote}”` : ""}
                          </small>
                        ) : (
                          <Tag value="In force" severity="danger" />
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
