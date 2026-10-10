"use client";

import { Tag } from "primereact/tag";

const when = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" })
    : "";

/**
 * The devices your subscriptions are used on — to look at, not to change.
 *
 * Nobody adds a device by hand: it takes a place the first time it signs in,
 * if one is free. Removing one, or allowing more, is for whoever reviews
 * subscriptions, so this says who to ask instead of offering a button.
 */
export default function MyDevices({ data }) {
  if (!data) return null;

  const usage = data.usage.filter((u) => u.allowed > 0 || u.used > 0);
  if (!usage.length && !data.devices.length) return null;

  return (
    <section className="card sub-history" aria-labelledby="sub-devices-title">
      <h2 id="sub-devices-title">Your devices</h2>
      <p className="sub-mydevices__about">
        A device takes a place the first time you sign in on it. To have one removed, or to use more devices, ask whoever
        approved your subscription.
      </p>

      <div className="sub-usage">
        {usage.map((u) => (
          <span key={u.platformId} className={`sub-usage__item${u.used >= u.allowed ? " is-full" : ""}`}>
            <strong>
              {u.used} of {u.allowed}
            </strong>
            {u.name}
          </span>
        ))}
      </div>

      {data.devices.length === 0 ? (
        <p className="sub-muted sub-mydevices__none">No device has signed in yet.</p>
      ) : (
        <ul>
          {data.devices.map((device) => (
            <li key={device.id}>
              <span className="sub-history__what">
                <strong>{device.platform?.name}</strong>
                <code className="sub-device-id">{device.deviceId}</code>
              </span>
              <span className="sub-history__how">
                {device.isBlocked && <Tag value="Blocked" severity="danger" />}
                <small>
                  First used {when(device.firstSeenAt)} · last used {when(device.lastSeenAt)}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
