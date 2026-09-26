import api from "@/lib/api";

/**
 * Background jobs (Phase 8B): work carried on after the request that started
 * it — a cancelled departure's refunds, and the message to each passenger.
 */

export const JOB_STATUS_LABELS = {
  queued: "Waiting",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
};

export const JOB_STATUS_SEVERITY = {
  queued: "info",
  running: "warning",
  succeeded: "success",
  failed: "danger",
};

/** Plain names for the job types, for people rather than for code. */
export const JOB_TYPE_LABELS = {
  "refund.trip_cancellation": "Departure refunds",
  "refund.coach_cancellation": "Coach refunds",
  "notify.departure_cancelled": "Cancellation email",
};

export async function fetchJobs(params = {}) {
  const { data } = await api.get("/jobs", { params });
  return data;
}

export async function fetchJob(id) {
  const { data } = await api.get(`/jobs/${id}`);
  return data.job;
}

export async function retryJob(id) {
  const { data } = await api.post(`/jobs/${id}/retry`);
  return data;
}

/**
 * Watch a job until it finishes, reporting each reading.
 *
 * For the operator who just cancelled a departure whose refunds did not finish
 * while the request waited: the screen can say how far they have got, and say
 * so again when they are done, without anyone refreshing. Gives up quietly
 * after `timeoutMs` — the job carries on regardless, and is on the Background
 * Jobs screen.
 */
export function followJob(id, { onUpdate, intervalMs = 2000, timeoutMs = 10 * 60_000 } = {}) {
  let stopped = false;
  const deadline = Date.now() + timeoutMs;

  const done = (async () => {
    while (!stopped && Date.now() < deadline) {
      let job = null;
      try {
        job = await fetchJob(id);
      } catch {
        // A blip reading it is not the job failing; try again next tick.
      }
      if (job) {
        onUpdate?.(job);
        if (job.status === "succeeded" || job.status === "failed") return job;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  })();

  return { done, stop: () => (stopped = true) };
}

/** "12 of 40" — or nothing, when the job has not said. */
export function progressText(job) {
  const p = job?.progress;
  if (!p || !Number.isFinite(p.total)) return "";
  return `${p.done ?? 0} of ${p.total}`;
}
