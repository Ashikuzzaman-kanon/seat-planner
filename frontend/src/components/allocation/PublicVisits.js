"use client";

import { useState } from "react";
import Link from "next/link";
import { Tag } from "primereact/tag";
import api from "@/lib/api";
import { stationLabel, when } from "@/lib/allocation";

const n = (x) => Number(x || 0).toLocaleString("en-GB");

export const OUTCOMES = {
  shown: ["Shown", "success"],
  sign_in: ["Asked to sign in", "info"],
  rate_limited: ["Too many requests", "warning"],
  bot_check: ["Bot check", "warning"],
  refused: ["Refused", "danger"],
  off: ["Page off", "secondary"],
};

/** "Dhaka → Rajshahi · S_CHAIR", "From Dhaka", "Train 753", or "Everything". */
export function journeyText(q) {
  if (!q) return "—";
  const from = q.from && stationLabel(q.from);
  const to = q.to && stationLabel(q.to);
  const where = from && to ? `${from} → ${to}` : from ? `From ${from}` : to ? `To ${to}` : null;
  const parts = [q.train && `Train ${q.train}`, where, q.class].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Everything";
}

/**
 * How the public page is used, on the Requests tab (allocation:requests):
 * visits and searches today, this week and this month, how many were asked to
 * sign in or turned away, the journeys searched most, where visitors are and
 * what they use, and the latest visits one by one.
 */
export default function PublicVisits() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const { data: d } = await api.get("/allocation/public-visits");
      setData(d);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <details className="card al-visits al-public" onToggle={(e) => e.currentTarget.open && !data && load()}>
      <summary>
        <span>Public page</span>
        <small className="al-muted">
          Who is using <Link href="/seat-allocation">/seat-allocation</Link> without signing in
        </small>
      </summary>
      {error && <p className="al-warn">{error}</p>}
      {!data && !error && <p className="al-muted">Loading…</p>}
      {data && (
        <div className="al-visits__body">
          <p className="al-visits__state">
            <Tag value={data.enabled ? "Open to the public" : "Not public"} severity={data.enabled ? "success" : "secondary"} />
            <span className="al-muted">
              Switched in <Link href="/dashboard/settings">Settings → Public seat allocation</Link>
              {" · "}bot check {data.botCheck ? "on" : "off (no Turnstile keys)"}
              {" · "}visitor addresses {data.edgeSecret ? "vouched for by the website" : "taken as sent (no PUBLIC_EDGE_SECRET)"}
              {" · "}visits kept {data.keptDays} days
            </span>
          </p>

          <table className="al-visits__totals">
            <thead>
              <tr>
                <th />
                <th>Visitors</th>
                <th>Searches</th>
                <th>Asked to sign in</th>
                <th>Turned away</th>
                <th>Requests</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Today", data.today],
                ["Last 7 days", data.week],
                ["Last 30 days", data.month],
              ].map(([label, t]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{n(t.visitors)}</td>
                  <td>{n(t.searches)}</td>
                  <td>{n(t.prompted)}</td>
                  <td>{n(t.blocked)}</td>
                  <td>{n(t.requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.earlier && (
            <p className="al-muted">
              Before that ({data.earlier.from} to {data.earlier.to}): {n(data.earlier.searches)} searches,{" "}
              {n(data.earlier.requests)} requests, kept as daily totals.
            </p>
          )}

          <div className="al-visits__cols">
            <section>
              <h4>Searched most (30 days)</h4>
              {data.journeys.length ? (
                <ol className="al-visits__rank">
                  {data.journeys.map((j, i) => (
                    <li key={i}>
                      <span>{journeyText(j.query)}</span>
                      <span className="al-muted">
                        {n(j.searches)} · {n(j.visitors)} visitor{j.visitors === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="al-muted">No searches yet.</p>
              )}
            </section>
            <section>
              <h4>Where from</h4>
              <ul className="al-visits__rank">
                {data.countries.map((c) => (
                  <li key={c.value || "unknown"}>
                    <span>{c.value || "Unknown"}</span>
                    <span className="al-muted">{n(c.visitors)}</span>
                  </li>
                ))}
              </ul>
              <h4>On</h4>
              <ul className="al-visits__rank">
                {data.devices.map((d) => (
                  <li key={d.value || "unknown"}>
                    <span>{d.value || "Unknown"}</span>
                    <span className="al-muted">{n(d.visitors)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <h4>Latest visits</h4>
          <div className="al-visits__latest">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Outcome</th>
                  <th>From</th>
                  <th>Using</th>
                  <th>Came from</th>
                </tr>
              </thead>
              <tbody>
                {data.latest.map((v, i) => {
                  const [label, severity] =
                    v.kind === "pass" && v.outcome === "shown" ? ["Passed", "success"] : OUTCOMES[v.outcome] || [v.outcome, "secondary"];
                  return (
                    <tr key={i}>
                      <td className="al-nowrap">{when(v.at)}</td>
                      <td>
                        {v.kind === "list" ? journeyText(v.query) : v.kind === "meta" ? "Opened the page" : "Bot check"}
                        {v.results != null && <span className="al-muted"> · {n(v.results)}</span>}
                        {v.user && <span className="al-muted"> · {v.user.fullName}</span>}
                      </td>
                      <td>
                        <Tag value={label} severity={severity} />
                      </td>
                      <td>
                        {v.ip || "—"}
                        <span className="al-muted">{[v.city, v.country].filter(Boolean).length ? ` · ${[v.city, v.country].filter(Boolean).join(", ")}` : ""}</span>
                      </td>
                      <td>{[v.browser, v.os, v.device].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="al-break">{v.referrer || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </details>
  );
}
