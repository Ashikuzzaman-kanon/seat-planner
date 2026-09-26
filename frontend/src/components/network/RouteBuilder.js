"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "primereact/dialog";
import Select from "@/components/ui/Select";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Button } from "primereact/button";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";
import { fetchTrain, saveRoute } from "@/lib/network";

import { tip, TIP } from "@/components/ui/tip";
const BLANK_STOP = {
  stationId: null,
  arrivalTime: "",
  departureTime: "",
  dayOffset: 0,
  distanceKm: null,
};

/** "23:30" -> 1410. Returns null for anything unparseable. */
function minutes(time) {
  const match = /^(\d{1,2}):(\d{2})/.exec(time || "");
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function absolute(time, dayOffset) {
  const m = minutes(time);
  return m === null ? null : dayOffset * 1440 + m;
}

/**
 * Mirrors the server's route rules so problems surface while typing rather
 * than on save. The server remains the authority — this only shortens the loop.
 */
function localProblems(stops) {
  const problems = [];
  if (stops.length < 2) problems.push("A route needs at least two stops");

  stops.forEach((stop, i) => {
    if (!stop.stationId) problems.push(`Stop ${i + 1} has no station`);
  });

  const ids = stops.map((s) => s.stationId).filter(Boolean);
  if (new Set(ids).size !== ids.length) problems.push("A station appears more than once");

  if (stops[0] && !stops[0].departureTime) problems.push("The origin needs a departure time");
  const last = stops[stops.length - 1];
  if (last && !last.arrivalTime) problems.push("The terminus needs an arrival time");
  if (stops[0] && Number(stops[0].distanceKm || 0) !== 0) {
    problems.push("The origin must be at distance 0");
  }

  let previous = null;
  stops.forEach((stop, i) => {
    for (const [time, label] of [
      [stop.arrivalTime, `stop ${i + 1} arrival`],
      [stop.departureTime, `stop ${i + 1} departure`],
    ]) {
      const moment = absolute(time, stop.dayOffset || 0);
      if (moment === null) continue;
      if (previous !== null && moment < previous.moment) {
        problems.push(`${label} is earlier than ${previous.label} — check times and day offsets`);
      }
      previous = { moment, label };
    }
  });

  let lastDistance = null;
  stops.forEach((stop, i) => {
    if (stop.distanceKm == null) return;
    if (lastDistance !== null && Number(stop.distanceKm) < lastDistance) {
      problems.push(`Stop ${i + 1} is closer to the origin than the stop before it`);
    }
    lastDistance = Number(stop.distanceKm);
  });

  return [...new Set(problems)];
}

export default function RouteBuilder({ train, stations, visible, onHide, onSaved, canEdit }) {
  const [stops, setStops] = useState([]);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);

  useEffect(() => {
    if (!visible || !train) return;
    setServerError(null);
    fetchTrain(train.id)
      .then((full) =>
        setStops(
          (full.stops || []).map((s) => ({
            stationId: s.stationId,
            arrivalTime: (s.arrivalTime || "").slice(0, 5),
            departureTime: (s.departureTime || "").slice(0, 5),
            dayOffset: s.dayOffset || 0,
            distanceKm: s.distanceKm,
          }))
        )
      )
      .catch(() => setStops([]));
  }, [visible, train]);

  const stationOptions = useMemo(
    () => stations.map((s) => ({ label: `${s.name} (${s.code})`, value: s.id })),
    [stations]
  );

  const problems = useMemo(() => localProblems(stops), [stops]);

  const summary = useMemo(() => {
    const start = stops[0] ? absolute(stops[0].departureTime, stops[0].dayOffset || 0) : null;
    const end = stops.length
      ? absolute(stops[stops.length - 1].arrivalTime, stops[stops.length - 1].dayOffset || 0)
      : null;
    const total = start !== null && end !== null ? end - start : null;
    return {
      segments: Math.max(stops.length - 1, 0),
      journey: total === null ? null : `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`,
      overnight: stops.some((s) => (s.dayOffset || 0) > 0),
      distance: stops.length ? stops[stops.length - 1].distanceKm : null,
    };
  }, [stops]);

  const patch = (index, changes) =>
    setStops((prev) => prev.map((s, i) => (i === index ? { ...s, ...changes } : s)));

  const move = (index, delta) =>
    setStops((prev) => {
      const next = [...prev];
      const [row] = next.splice(index, 1);
      next.splice(index + delta, 0, row);
      return next;
    });

  /**
   * When a time reads as earlier than the stop before it, the usual cause is a
   * train that has crossed midnight — so offer the fix rather than only the error.
   */
  const bumpDay = (index) => patch(index, { dayOffset: (stops[index].dayOffset || 0) + 1 });

  const save = async () => {
    setSaving(true);
    setServerError(null);
    try {
      const payload = stops.map((s) => ({
        stationId: s.stationId,
        arrivalTime: s.arrivalTime || null,
        departureTime: s.departureTime || null,
        dayOffset: s.dayOffset || 0,
        distanceKm: s.distanceKm ?? null,
      }));
      const result = await saveRoute(train.id, payload);
      onSaved?.(result.train, result.message);
      onHide();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      header={train ? `Route — ${train.name}` : "Route"}
      visible={visible}
      style={{ width: "72rem", maxWidth: "96vw" }}
      onHide={onHide}
      footer={
        <>
          <Button label="Close" text onClick={onHide} disabled={saving} />
          <Button
            label="Save route"
            icon="pi pi-check"
            loading={saving}
            disabled={!canEdit || problems.length > 0}
            onClick={save}
          />
        </>
      }
    >
      <div className="route-summary">
        <Tag value={`${stops.length} stops`} severity="info" />
        <Tag value={`${summary.segments} segments`} severity="info" />
        {summary.journey && <Tag value={summary.journey} severity="success" />}
        {summary.overnight && <Tag value="Overnight" severity="warning" icon="pi pi-moon" />}
        {summary.distance != null && <Tag value={`${summary.distance} km`} severity="secondary" />}
      </div>

      <p className="route-hint">
        Segments are what seats are sold against: a route of {stops.length || "n"} stops sells{" "}
        {summary.segments || "n−1"} independently bookable legs. Distance is cumulative from the
        origin, and a stop reached after midnight needs its day set to +1.
      </p>

      {serverError && <Message severity="error" text={serverError} style={{ width: "100%", marginBottom: "0.75rem" }} />}

      {problems.length > 0 && (
        <Message
          severity="warn"
          style={{ width: "100%", marginBottom: "0.75rem" }}
          content={
            <div>
              <strong>This route is not coherent yet</strong>
              <ul style={{ margin: "0.35rem 0 0 1rem", padding: 0 }}>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          }
        />
      )}

      <div className="route-table-scroll">
        <table className="route-table">
          <thead>
            <tr>
              <th style={{ width: "2.5rem" }}>#</th>
              <th>Station</th>
              <th style={{ width: "7rem" }}>Arrives</th>
              <th style={{ width: "7rem" }}>Departs</th>
              <th style={{ width: "7rem" }}>Day</th>
              <th style={{ width: "8rem" }}>Km from origin</th>
              <th style={{ width: "8rem" }}></th>
            </tr>
          </thead>
          <tbody>
            {stops.map((stop, i) => {
              const isFirst = i === 0;
              const isLast = i === stops.length - 1;
              return (
                <tr key={i}>
                  <td className="route-seq">{i + 1}</td>
                  <td>
                    <Select
                      value={stop.stationId}
                      options={stationOptions}
                      onChange={(e) => patch(i, { stationId: e.value })}
                      filter
                      placeholder="Choose a station"
                      disabled={!canEdit}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <InputText
                      value={stop.arrivalTime}
                      onChange={(e) => patch(i, { arrivalTime: e.target.value })}
                      placeholder={isFirst ? "—" : "HH:MM"}
                      disabled={!canEdit || isFirst}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <InputText
                      value={stop.departureTime}
                      onChange={(e) => patch(i, { departureTime: e.target.value })}
                      placeholder={isLast ? "—" : "HH:MM"}
                      disabled={!canEdit || isLast}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <div className="route-day">
                      <span className={stop.dayOffset ? "day-badge on" : "day-badge"}>
                        +{stop.dayOffset || 0}
                      </span>
                      <Button aria-label="Reached after midnight" tooltipOptions={TIP}
                        icon="pi pi-plus"
                        rounded
                        text
                        size="small"
                        disabled={!canEdit || isFirst}
                        onClick={() => bumpDay(i)}
                        tooltip="Reached after midnight"
                      />
                      <Button {...tip("Back to the same day")}
                        icon="pi pi-minus"
                        rounded
                        text
                        size="small"
                        disabled={!canEdit || !stop.dayOffset}
                        onClick={() => patch(i, { dayOffset: stop.dayOffset - 1 })}
                      />
                    </div>
                  </td>
                  <td>
                    <InputNumber
                      value={stop.distanceKm}
                      onValueChange={(e) => patch(i, { distanceKm: e.value })}
                      min={0}
                      maxFractionDigits={2}
                      disabled={!canEdit}
                      inputStyle={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.15rem", justifyContent: "flex-end" }}>
                      <Button {...tip("Move stop up")} icon="pi pi-angle-up" rounded text size="small" disabled={!canEdit || isFirst} onClick={() => move(i, -1)} />
                      <Button {...tip("Move stop down")} icon="pi pi-angle-down" rounded text size="small" disabled={!canEdit || isLast} onClick={() => move(i, 1)} />
                      <Button {...tip("Remove this stop")}
                        icon="pi pi-trash"
                        rounded
                        text
                        severity="danger"
                        size="small"
                        disabled={!canEdit}
                        onClick={() => setStops((prev) => prev.filter((_, idx) => idx !== i))}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button
        label="Add stop"
        icon="pi pi-plus"
        outlined
        disabled={!canEdit}
        style={{ marginTop: "0.75rem" }}
        onClick={() =>
          setStops((prev) => [
            ...prev,
            { ...BLANK_STOP, dayOffset: prev.length ? prev[prev.length - 1].dayOffset : 0 },
          ])
        }
      />
    </Dialog>
  );
}
