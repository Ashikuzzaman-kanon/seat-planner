"use client";

import { useEffect, useState } from "react";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Checkbox } from "primereact/checkbox";
import { fetchProfile, saveProfile, asPassenger } from "@/lib/profile";
import HoldTimer from "./HoldTimer";

/**
 * Who is travelling.
 *
 * One form per seat, because a ticket belongs to a named person: the NID on it
 * is what a checker matches against the card in their hand, and it is what
 * makes a transfer later a deliberate, approved act rather than a resale.
 *
 * Validated here as well as on the server — not instead of. The server is the
 * authority; this is so a passenger finds out about a mistyped NID before they
 * have paid for it.
 */

const NID = /^\d{10,17}$/;
const DOB = /^\d{4}-\d{2}-\d{2}$/;

const blank = () => ({ name: "", nid: "", dob: "" });

export default function PassengerStep({ hold, seats, note, onSubmit, onBack, onExpire }) {
  const [passengers, setPassengers] = useState(() => seats.map(blank));
  const [touched, setTouched] = useState({});
  const [prefilled, setPrefilled] = useState(false);

  /*
   * A first booking needs the buyer's own details on their profile — the
   * server refuses payment without them. Found out here rather than at the
   * Pay button, where it used to surface after everything else was filled in.
   * `null` until the profile has been read.
   */
  const [needsProfile, setNeedsProfile] = useState(null);
  const [saveAsMine, setSaveAsMine] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    setPassengers((current) =>
      seats.map((_, i) => current[i] || blank())
    );
  }, [seats.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * The first seat is assumed to be the person buying, because it almost always
   * is. Only the first, and only while it is still untouched — overwriting a
   * form someone has started filling in would be worse than not helping at all.
   */
  useEffect(() => {
    let cancelled = false;

    fetchProfile()
      .then((profile) => {
        if (cancelled) return;
        setNeedsProfile(!profile?.hasTravelProfile);
        const me = asPassenger(profile);
        if (!me) return;

        setPassengers((current) => {
          const first = current[0];
          if (!first || first.name || first.nid || first.dob) return current;
          return [{ ...me }, ...current.slice(1)];
        });
        setPrefilled(true);
      })
      .catch(() => {
        // Nothing to pre-fill with. The form works exactly as it did before.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const update = (index, field, value) =>
    setPassengers((current) =>
      current.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );

  const problems = passengers.map((p) => ({
    name: p.name.trim().length < 2 ? "Enter the passenger's full name" : null,
    nid: !NID.test(p.nid.trim()) ? "National ID is 10 to 17 digits" : null,
    dob: !DOB.test(p.dob.trim())
      ? "Use YYYY-MM-DD"
      : new Date(p.dob) > new Date()
        ? "That date is in the future"
        : null,
  }));

  const duplicateNids = (() => {
    const seen = new Map();
    passengers.forEach((p, i) => {
      const nid = p.nid.trim();
      if (!nid) return;
      seen.set(nid, (seen.get(nid) || 0) + 1);
    });
    return passengers.map((p) => (seen.get(p.nid.trim()) || 0) > 1);
  })();

  const valid =
    problems.every((p) => !p.name && !p.nid && !p.dob) && !duplicateNids.some(Boolean);

  const show = (index, field) => touched[`${index}.${field}`] && problems[index][field];

  const recheckProfile = () =>
    fetchProfile()
      .then((profile) => setNeedsProfile(!profile?.hasTravelProfile))
      .catch(() => {});

  const submit = async () => {
    setSaveError(null);
    if (needsProfile && saveAsMine) {
      const me = passengers[0];
      setSaving(true);
      try {
        await saveProfile({ fullName: me.name.trim(), nid: me.nid.trim(), dateOfBirth: me.dob.trim() });
        setNeedsProfile(false);
      } catch (err) {
        setSaveError(err.message);
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    onSubmit(
      passengers.map((p, i) => ({
        name: p.name.trim(),
        nid: p.nid.trim(),
        dob: p.dob.trim(),
        tripSeatId: seats[i].id,
      }))
    );
  };

  return (
    <div className="book-step">
      <div className="book-holdbar card">
        <div>
          <strong>Seats held</strong>
          <span className="book-holdbar__seats">
            {seats.map((s) => `${s.coachCode || ""} ${s.seatNumber}`.trim()).join(" · ")}
          </span>
          {note && <small className="book-holdbar__note">{note}</small>}
        </div>
        <HoldTimer expiresAt={hold.expiresAt} onExpire={onExpire} />
      </div>

      <div className="passenger-forms">
        {seats.map((seat, index) => (
          <section key={seat.id} className="card passenger-card">
            <header className="passenger-card__head">
              <h3>Passenger {index + 1}</h3>
              <span className="passenger-seat">
                Coach {seat.coachCode || "—"} · seat {seat.seatNumber}
              </span>
            </header>

            <div className="passenger-fields">
              <div className="passenger-field">
                <label htmlFor={`name-${index}`}>Full name</label>
                <InputText
                  id={`name-${index}`}
                  value={passengers[index]?.name || ""}
                  onChange={(e) => update(index, "name", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, [`${index}.name`]: true }))}
                  className={show(index, "name") ? "p-invalid" : ""}
                  placeholder="As printed on the National ID"
                  autoComplete="name"
                />
                {show(index, "name") && <small className="field-error">{problems[index].name}</small>}
              </div>

              <div className="passenger-field">
                <label htmlFor={`nid-${index}`}>National ID</label>
                <InputText
                  id={`nid-${index}`}
                  value={passengers[index]?.nid || ""}
                  onChange={(e) => update(index, "nid", e.target.value.replace(/\D/g, ""))}
                  onBlur={() => setTouched((t) => ({ ...t, [`${index}.nid`]: true }))}
                  className={show(index, "nid") || duplicateNids[index] ? "p-invalid" : ""}
                  inputMode="numeric"
                  placeholder="10 to 17 digits"
                />
                {show(index, "nid") && <small className="field-error">{problems[index].nid}</small>}
                {duplicateNids[index] && (
                  <small className="field-error">
                    Two passengers cannot share a National ID
                  </small>
                )}
              </div>

              <div className="passenger-field">
                <label htmlFor={`dob-${index}`}>Date of birth</label>
                <InputText
                  id={`dob-${index}`}
                  type="date"
                  value={passengers[index]?.dob || ""}
                  onChange={(e) => update(index, "dob", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, [`${index}.dob`]: true }))}
                  className={show(index, "dob") ? "p-invalid" : ""}
                  max={new Date().toISOString().slice(0, 10)}
                />
                {show(index, "dob") && <small className="field-error">{problems[index].dob}</small>}
              </div>
            </div>
          </section>
        ))}
      </div>

      {prefilled && (
        <Message
          severity="success"
          className="book-message"
          text="Passenger 1 has been filled in from your profile. Change it if this seat is for somebody else."
        />
      )}

      <Message
        severity="info"
        className="book-message"
        text="Each passenger must carry the National ID used here. Transferring a ticket to a different ID later needs approval."
      />

      {needsProfile && (
        <section className="card profile-needed" aria-live="polite">
          <div className="profile-needed__head">
            <i className="pi pi-id-card" aria-hidden="true" />
            <div>
              <strong>Your first booking</strong>
              <p>
                Your own name, National ID and date of birth go on your profile once, before
                you can pay. After that, checkout fills them in for you.
              </p>
            </div>
          </div>
          <label className="profile-needed__choice">
            <Checkbox
              inputId="save-as-mine"
              checked={saveAsMine}
              onChange={(e) => setSaveAsMine(e.checked)}
            />
            <span>Passenger 1 is me — save these details to my profile</span>
          </label>
          {!saveAsMine && (
            <p className="profile-needed__other">
              Then add your own details on{" "}
              <a href="/dashboard/profile" target="_blank" rel="noopener noreferrer">
                My Profile <i className="pi pi-external-link" aria-hidden="true" />
              </a>{" "}
              — it opens in a new tab, so these seats stay held here.{" "}
              <Button label="I have — check again" link size="small" onClick={recheckProfile} />
            </p>
          )}
          {saveError && <Message severity="error" className="book-message" text={saveError} />}
        </section>
      )}

      <div className="book-nav">
        <Button label="Back" icon="pi pi-angle-left" text onClick={onBack} />
        <Button
          label={needsProfile && saveAsMine ? "Save and continue to payment" : "Continue to payment"}
          icon="pi pi-angle-right"
          iconPos="right"
          loading={saving}
          disabled={!valid || (needsProfile && !saveAsMine)}
          onClick={submit}
          className="book-continue"
        />
      </div>
    </div>
  );
}
