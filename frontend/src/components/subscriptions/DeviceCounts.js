"use client";

import { totalOf } from "@/lib/subscriptions";

/**
 * How many devices of each platform: a row per platform, a stepper on each.
 *
 * `value` is what the API takes — `{ windows: 2, android: 1 }`. Plain buttons
 * either side of the number rather than a typed field: the range is 0 to 10,
 * and on a phone two big targets beat a keyboard.
 */
export default function DeviceCounts({ platforms, value, onChange, max = 10, id = "devices" }) {
  const total = totalOf(value);
  const set = (platform, count) => onChange({ ...value, [platform.value]: Math.min(max, Math.max(0, count)) });

  if (!platforms.length) {
    return <p className="sub-devices-form__hint is-error">There are no platforms to subscribe on yet.</p>;
  }

  return (
    <div className="sub-devices-form" role="group" aria-label="Devices">
      {platforms.map((platform) => {
        const count = Number(value?.[platform.value]) || 0;
        return (
          <div key={platform.value} className="sub-devices-form__row">
            <span className="sub-devices-form__name" id={`${id}-${platform.value}-label`}>
              {platform.name}
            </span>
            <span className="sub-stepper" data-platform={platform.value}>
              <button
                type="button"
                className="sub-stepper__btn"
                onClick={() => set(platform, count - 1)}
                disabled={count <= 0}
                aria-label={`One fewer ${platform.name} device`}
              >
                <i className="pi pi-minus" aria-hidden="true" />
              </button>
              <output className="sub-stepper__value" aria-labelledby={`${id}-${platform.value}-label`} aria-live="polite">
                {count}
              </output>
              <button
                type="button"
                className="sub-stepper__btn"
                onClick={() => set(platform, count + 1)}
                disabled={count >= max}
                aria-label={`One more ${platform.name} device`}
              >
                <i className="pi pi-plus" aria-hidden="true" />
              </button>
            </span>
          </div>
        );
      })}
      <p className={`sub-devices-form__hint${total ? "" : " is-error"}`} aria-live="polite">
        {total
          ? `${total} device${total === 1 ? "" : "s"} in all · up to ${max} of each`
          : "Choose at least one device."}
      </p>
    </div>
  );
}
