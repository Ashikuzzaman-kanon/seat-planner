"use client";

import { Calendar } from "primereact/calendar";
import Chips from "./Chips";
import { addDays, dayOfPicked, longDate, pickedOfDay, todayInDhaka } from "@/lib/subscriptions";

const PRESETS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "6 months", value: 180 },
  { label: "1 year", value: 365 },
  { label: "Pick a date", value: "date" },
];

/** The last day a period gives, as YYYY-MM-DD, or null while none is chosen. */
export const lastDayOf = (period) =>
  period?.lastDay || (period?.days ? addDays(todayInDhaka(), period.days) : null);

/** Whether a period is complete enough to send. */
export const isChosen = (period) => Boolean(lastDayOf(period));

/**
 * How long a subscription runs: a number of days from today, or a last day.
 *
 * `value` is what the API takes — `{ days }` or `{ lastDay }` — and the line
 * underneath says the day it comes to, because "30 days" is a sum nobody
 * should have to do in their head before pressing Approve.
 */
export default function PeriodPicker({ value, onChange, id = "period" }) {
  const byDate = value && "lastDay" in value;
  const choice = byDate ? "date" : (value?.days ?? null);
  const lastDay = lastDayOf(value);

  return (
    <div className="sub-period">
      <Chips
        options={PRESETS}
        value={choice}
        onChange={(picked) => onChange(picked === "date" ? { lastDay: lastDay || "" } : { days: picked })}
        ariaLabel="How long"
      />

      {byDate && (
        <Calendar
          value={pickedOfDay(value.lastDay)}
          onChange={(e) => onChange({ lastDay: dayOfPicked(e.value) || "" })}
          minDate={pickedOfDay(todayInDhaka())}
          dateFormat="d M yy"
          placeholder="Last day"
          showIcon
          inputId={`${id}-date`}
          aria-label="Last day"
          className="sub-period__date"
        />
      )}

      <p className="sub-period__until" aria-live="polite">
        {lastDay ? (
          <>
            Valid through <strong>{longDate(lastDay)}</strong> — the whole of that day, Dhaka time.
          </>
        ) : (
          "Choose how long it runs."
        )}
      </p>
    </div>
  );
}
