"use client";

import { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import Select from "@/components/ui/Select";
import { Message } from "primereact/message";
import { joinWaitlist } from "@/lib/booking";
import { fetchProfile, asPassenger } from "@/lib/profile";

/**
 * Queueing for a departure that is full.
 *
 * Who is travelling is asked for here, rather than when a seat is offered,
 * because the offer is the one moment that is time-critical — a seat is out of
 * sale for everyone while it waits for an answer. Asked now, the answer later
 * is a single click. The passenger's own details fill the first row, so for the
 * common case this is a confirmation rather than a form.
 */

const NID = /^\d{10,17}$/;
const DOB = /^\d{4}-\d{2}-\d{2}$/;

const blank = () => ({ name: "", nid: "", dob: "" });

export default function JoinWaitlistDialog({ visible, onHide, departure, journey, onJoined, onError }) {
  const [count, setCount] = useState(journey?.count || 1);
  const [passengers, setPassengers] = useState([blank()]);
  const [coachClassId, setCoachClassId] = useState(null);
  const [working, setWorking] = useState(false);
  const [touched, setTouched] = useState({});

  // Reset each time it opens: a dialog that remembers the last attempt would
  // put a stranger's details in front of the next passenger.
  useEffect(() => {
    if (!visible) return;
    const wanted = journey?.count || 1;
    setCount(wanted);
    setCoachClassId(null);
    setTouched({});
    setPassengers(Array.from({ length: wanted }, blank));

    fetchProfile()
      .then((profile) => {
        const me = asPassenger(profile);
        if (!me) return;
        setPassengers((current) => {
          const first = current[0];
          if (!first || first.name || first.nid || first.dob) return current;
          return [me, ...current.slice(1)];
        });
      })
      .catch(() => {
        // No profile is not an error here; the fields are simply empty.
      });
  }, [visible, journey?.count]);

  // Keep the rows in step with how many seats are being queued for.
  useEffect(() => {
    setPassengers((current) =>
      current.length === count
        ? current
        : Array.from({ length: count }, (_, i) => current[i] || blank())
    );
  }, [count]);

  const update = (index, field, value) =>
    setPassengers((current) =>
      current.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );

  const problems = passengers.map((p) => ({
    name: p.name.trim().length < 2 ? "A name is needed" : null,
    nid: !NID.test(p.nid.trim()) ? "National ID is 10 to 17 digits" : null,
    dob: !DOB.test(p.dob.trim())
      ? "Use YYYY-MM-DD"
      : new Date(p.dob) > new Date()
        ? "That is in the future"
        : null,
  }));

  const ready = problems.every((p) => !p.name && !p.nid && !p.dob);
  const show = (index, field) => touched[`${index}.${field}`] && problems[index][field];

  const submit = async () => {
    setWorking(true);
    try {
      const entry = await joinWaitlist({
        tripId: departure.tripId,
        fromStationId: journey.fromStationId,
        toStationId: journey.toStationId,
        count,
        coachClassId,
        passengers: passengers.map((p) => ({
          name: p.name.trim(),
          nid: p.nid.trim(),
          dob: p.dob.trim(),
        })),
      });
      onJoined?.(entry);
      onHide();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setWorking(false);
    }
  };

  const classOptions = [
    { label: "Any class — whatever comes free first", value: null },
    ...(departure?.fares || []).map((f) => ({
      label: `${f.coachClass} only — ৳ ${f.fareFormatted}`,
      value: f.coachClassId,
    })),
  ];

  const seatOptions = [1, 2, 3, 4].map((n) => ({
    label: `${n} seat${n === 1 ? "" : "s"}`,
    value: n,
  }));

  return (
    <Dialog
      header="Join the queue"
      visible={visible}
      onHide={onHide}
      className="waitlist-dialog"
      style={{ width: "min(560px, 94vw)" }}
      breakpoints={{ "640px": "94vw" }}
      dismissableMask
    >
      {departure && (
        <p className="waitlist-dialog__lead">
          <strong>{departure.train?.name}</strong> is full between{" "}
          {departure.from?.name} and {departure.to?.name}. Join the queue and the first seat
          returned is held for you — you will be emailed, and taking it is one click from your
          wallet.
        </p>
      )}

      <div className="waitlist-dialog__row">
        <label>
          <span>How many seats?</span>
          <Select
            value={count}
            options={seatOptions}
            onChange={(e) => setCount(e.value)}
            className="w-full"
          />
        </label>
        <label>
          <span>Which class?</span>
          <Select
            value={coachClassId}
            options={classOptions}
            onChange={(e) => setCoachClassId(e.value)}
            className="w-full"
          />
        </label>
      </div>

      {coachClassId && (
        <Message
          severity="info"
          className="waitlist-dialog__note"
          text="Holding out for one class means passing on seats in the others. Leave it on any class to convert sooner."
        />
      )}

      <h4 className="waitlist-dialog__heading">Who is travelling?</h4>
      <p className="waitlist-dialog__why">
        Asked now so that taking a seat later is a single click — a seat offered to you is out of
        sale for everyone else until you answer.
      </p>

      {passengers.map((p, index) => (
        <fieldset key={index} className="waitlist-passenger">
          <legend>Passenger {index + 1}</legend>

          <label>
            <span>Full name</span>
            <InputText
              value={p.name}
              onChange={(e) => update(index, "name", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, [`${index}.name`]: true }))}
              className={show(index, "name") ? "p-invalid" : ""}
            />
            {show(index, "name") && <small className="field-error">{problems[index].name}</small>}
          </label>

          <div className="waitlist-passenger__pair">
            <label>
              <span>National ID</span>
              <InputText
                value={p.nid}
                inputMode="numeric"
                onChange={(e) => update(index, "nid", e.target.value.replace(/\D/g, ""))}
                onBlur={() => setTouched((t) => ({ ...t, [`${index}.nid`]: true }))}
                className={show(index, "nid") ? "p-invalid" : ""}
              />
              {show(index, "nid") && <small className="field-error">{problems[index].nid}</small>}
            </label>

            <label>
              <span>Date of birth</span>
              <InputText
                value={p.dob}
                placeholder="YYYY-MM-DD"
                onChange={(e) => update(index, "dob", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, [`${index}.dob`]: true }))}
                className={show(index, "dob") ? "p-invalid" : ""}
              />
              {show(index, "dob") && <small className="field-error">{problems[index].dob}</small>}
            </label>
          </div>
        </fieldset>
      ))}

      <div className="waitlist-dialog__actions">
        <Button label="Cancel" text severity="secondary" onClick={onHide} />
        <Button
          label="Join the queue"
          icon="pi pi-clock"
          onClick={submit}
          disabled={!ready}
          loading={working}
        />
      </div>
    </Dialog>
  );
}
