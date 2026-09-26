"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Toast } from "primereact/toast";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import { fetchProfile, saveProfile } from "@/lib/profile";
import { useAuth } from "@/contexts/AuthContext";
import "@/components/booking/booking.css";
import "@/components/postsale/postsale.css";

/**
 * The account holder's own travel details.
 *
 * Entered once and reused at every checkout. A ticket still carries its own
 * passenger — one booking can be for four different people — but the common
 * case is buying for yourself, and re-typing a seventeen-digit National ID each
 * time is how a wrong digit ends up on a ticket and is discovered on a
 * platform.
 */

const NID = /^\d{10,17}$/;
const DOB = /^\d{4}-\d{2}-\d{2}$/;

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const router = useRouter();
  const toast = useRef(null);

  const [form, setForm] = useState({ fullName: "", nid: "", dateOfBirth: "" });
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState({});

  const load = useCallback(async () => {
    try {
      const profile = await fetchProfile();
      setForm({
        fullName: profile.fullName || "",
        nid: profile.nid || "",
        dateOfBirth: profile.dateOfBirth || "",
      });
      setComplete(profile.hasTravelProfile);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const problems = {
    fullName: form.fullName.trim().length < 2 ? "Enter your full name" : null,
    nid: !NID.test(form.nid.trim()) ? "National ID is 10 to 17 digits" : null,
    dateOfBirth: !DOB.test(form.dateOfBirth)
      ? "Pick your date of birth"
      : new Date(form.dateOfBirth) > new Date()
        ? "That date is in the future"
        : null,
  };
  const valid = !problems.fullName && !problems.nid && !problems.dateOfBirth;

  const save = async () => {
    setSaving(true);
    try {
      const profile = await saveProfile({
        fullName: form.fullName.trim(),
        nid: form.nid.trim(),
        dateOfBirth: form.dateOfBirth,
      });
      setComplete(profile.hasTravelProfile);
      toast.current?.show({
        severity: "success",
        summary: "Saved",
        detail: "Your details will fill themselves in at checkout.",
      });
      // The name is shown in the header, so the session copy has to keep up.
      await refresh?.();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not save", detail: err.message });
    } finally {
      setSaving(false);
    }
  };

  const show = (field) => touched[field] && problems[field];

  if (loading) {
    return (
      <div className="book-centre">
        <ProgressSpinner style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  return (
    <div className="profile-page">
      <Toast ref={toast} />

      <h1 className="page-title">My profile</h1>
      <p className="page-subtitle">
        Entered once, then filled in for you every time you book. A ticket can still be in
        somebody else&apos;s name — this is simply who you are.
      </p>

      {!complete && (
        <Message
          severity="warn"
          className="book-message"
          text="These are needed before your first booking. Nothing else is required."
        />
      )}

      <section className="card profile-card">
        <div className="profile-identity">
          <div>
            <span className="profile-label">Signed in as</span>
            <strong>{user?.email}</strong>
          </div>
          {complete ? (
            <Tag icon="pi pi-check" severity="success" value="Ready to book" />
          ) : (
            <Tag icon="pi pi-exclamation-circle" severity="warning" value="Not yet complete" />
          )}
        </div>

        <div className="passenger-fields profile-fields">
          <div className="passenger-field">
            <label htmlFor="fullName">Full name</label>
            <InputText
              id="fullName"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              onBlur={() => setTouched((t) => ({ ...t, fullName: true }))}
              className={show("fullName") ? "p-invalid" : ""}
              placeholder="As printed on your National ID"
              autoComplete="name"
            />
            {show("fullName") && <small className="field-error">{problems.fullName}</small>}
          </div>

          <div className="passenger-field">
            <label htmlFor="nid">National ID</label>
            <InputText
              id="nid"
              value={form.nid}
              onChange={(e) => setForm((f) => ({ ...f, nid: e.target.value.replace(/\D/g, "") }))}
              onBlur={() => setTouched((t) => ({ ...t, nid: true }))}
              className={show("nid") ? "p-invalid" : ""}
              inputMode="numeric"
              placeholder="10 to 17 digits"
            />
            {show("nid") && <small className="field-error">{problems.nid}</small>}
          </div>

          <div className="passenger-field">
            <label htmlFor="dob">Date of birth</label>
            <InputText
              id="dob"
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
              onBlur={() => setTouched((t) => ({ ...t, dateOfBirth: true }))}
              className={show("dateOfBirth") ? "p-invalid" : ""}
              max={new Date().toISOString().slice(0, 10)}
            />
            {show("dateOfBirth") && <small className="field-error">{problems.dateOfBirth}</small>}
          </div>
        </div>

        <p className="profile-note">
          A ticket checker matches the National ID on a ticket against the card in your hand, so
          it has to be the one you travel with.
        </p>

        <div className="return-actions">
          {complete && (
            <Button
              label="Book a ticket"
              icon="pi pi-ticket"
              text
              onClick={() => router.push("/dashboard/book")}
            />
          )}
          <span className="return-actions__spacer" />
          <Button
            label="Save"
            icon="pi pi-check"
            onClick={save}
            loading={saving}
            disabled={!valid}
          />
        </div>
      </section>
    </div>
  );
}
