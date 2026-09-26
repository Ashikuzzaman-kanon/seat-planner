"use client";

import { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Message } from "primereact/message";
import { ToggleButton } from "primereact/togglebutton";
import { fetchSchedule, saveSchedule, DAY_SHORT } from "@/lib/departures";

import { tip } from "@/components/ui/tip";
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const toDate = (value) => (value ? new Date(`${value}T00:00:00`) : null);
const toISO = (date) => {
  if (!date) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export default function ScheduleEditor({ train, visible, onHide, onSaved, canEdit }) {
  const [schedules, setSchedules] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible || !train) return;
    setError(null);
    fetchSchedule(train.id)
      .then((list) =>
        setSchedules(
          list.length
            ? list.map((s) => ({ ...s }))
            : [{ runsOn: [...ALL_DAYS], effectiveFrom: null, effectiveTo: null, isActive: true }]
        )
      )
      .catch((err) => setError(err.message));
  }, [visible, train]);

  const patch = (index, changes) =>
    setSchedules((prev) => prev.map((s, i) => (i === index ? { ...s, ...changes } : s)));

  const toggleDay = (index, day) => {
    const current = schedules[index].runsOn || [];
    patch(index, {
      runsOn: current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    });
  };

  const problems = [];
  if (!schedules.length) problems.push("Add at least one schedule");
  schedules.forEach((s, i) => {
    if (!s.runsOn?.length) problems.push(`Schedule ${i + 1} runs on no days`);
    if (s.effectiveFrom && s.effectiveTo && s.effectiveTo < s.effectiveFrom) {
      problems.push(`Schedule ${i + 1} ends before it starts`);
    }
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSchedule(
        train.id,
        schedules.map((s) => ({
          runsOn: s.runsOn,
          effectiveFrom: s.effectiveFrom || null,
          effectiveTo: s.effectiveTo || null,
          isActive: s.isActive !== false,
        }))
      );
      onSaved?.("Schedule saved");
      onHide();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      header={train ? `Schedule — ${train.name}` : "Schedule"}
      visible={visible}
      style={{ width: "42rem", maxWidth: "95vw" }}
      onHide={onHide}
      footer={
        <>
          <Button label="Close" text onClick={onHide} disabled={saving} />
          <Button
            label="Save schedule"
            icon="pi pi-check"
            loading={saving}
            disabled={!canEdit || problems.length > 0}
            onClick={save}
          />
        </>
      }
    >
      <p className="route-hint">
        Which days this train runs. Generation asks this for every date in the horizon, so a day
        turned off here simply produces no departure. Effective dates let a timetable change start
        on a date rather than rewriting what the train used to do.
      </p>

      {error && <Message severity="error" text={error} style={{ width: "100%", marginBottom: "0.75rem" }} />}
      {problems.length > 0 && (
        <Message severity="warn" text={problems.join(" · ")} style={{ width: "100%", marginBottom: "0.75rem" }} />
      )}

      {schedules.map((schedule, i) => (
        <div key={i} className="schedule-block">
          <div className="schedule-days">
            {ALL_DAYS.map((day) => (
              <ToggleButton
                key={day}
                checked={(schedule.runsOn || []).includes(day)}
                onLabel={DAY_SHORT[day]}
                offLabel={DAY_SHORT[day]}
                onIcon="pi pi-check"
                offIcon="pi pi-times"
                disabled={!canEdit}
                onChange={() => toggleDay(i, day)}
                className="schedule-day"
              />
            ))}
          </div>

          <div className="schedule-dates">
            <div className="field-block">
              <label>Effective from</label>
              <Calendar
                value={toDate(schedule.effectiveFrom)}
                onChange={(e) => patch(i, { effectiveFrom: toISO(e.value) })}
                dateFormat="yy-mm-dd"
                showButtonBar
                disabled={!canEdit}
                placeholder="Always"
              />
            </div>
            <div className="field-block">
              <label>Effective to</label>
              <Calendar
                value={toDate(schedule.effectiveTo)}
                onChange={(e) => patch(i, { effectiveTo: toISO(e.value) })}
                dateFormat="yy-mm-dd"
                showButtonBar
                disabled={!canEdit}
                placeholder="Open-ended"
              />
            </div>
            {schedules.length > 1 && (
              <Button {...tip("Remove this schedule")}
                icon="pi pi-trash"
                rounded
                text
                severity="danger"
                disabled={!canEdit}
                onClick={() => setSchedules((prev) => prev.filter((_, idx) => idx !== i))}
              />
            )}
          </div>
        </div>
      ))}

      <Button
        label="Add a period"
        icon="pi pi-plus"
        outlined
        size="small"
        disabled={!canEdit}
        onClick={() =>
          setSchedules((prev) => [...prev, { runsOn: [...ALL_DAYS], effectiveFrom: null, effectiveTo: null, isActive: true }])
        }
      />
    </Dialog>
  );
}
