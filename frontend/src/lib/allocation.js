import api from "@/lib/api";

/**
 * Seat allocation: which station pairs the railway actually gives seats to,
 * per train and class. The railway's own data, kept apart from the site's.
 */

/** What there is to filter by, and how much data there is. */
export async function fetchAllocationMeta() {
  const { data } = await api.get("/allocation/meta");
  return data;
}

/** Pairs matching { from, to, train, class, show: "allocated" | "all", page, pageSize }. */
export async function fetchAllocation(params = {}) {
  const { data } = await api.get("/allocation", { params: clean(params) });
  return data;
}

/** The counts sheet for the pairs matching the filters, saved as a file. */
export async function downloadCountsSheet(params = {}) {
  const { data } = await api.get("/allocation/counts.csv", { params: clean(params), responseType: "blob" });
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = "seat-counts.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Send a file: "stops" (train-stoppages.json), "census" or "counts". Read only
 * unless `apply`. Sent as plain text, since the files are larger than a JSON
 * body may be.
 */
export async function uploadAllocation(kind, text, apply = false, fileName = null) {
  const { data } = await api.post(`/allocation/import/${kind}`, text, {
    params: { ...(apply ? { apply: 1 } : {}), ...(fileName ? { name: fileName } : {}) },
    headers: { "Content-Type": "text/plain" },
  });
  return data;
}

/** { train, from, to, status: "allocated" | "not_allocated", classes: [{ code, seats|null }] } */
export async function saveAllocationPair(pair) {
  const { data } = await api.put("/allocation/pairs", pair);
  return data.pair;
}

/** Back to not checked. */
export async function clearAllocationPair({ train, from, to }) {
  await api.delete("/allocation/pairs", { params: { train, from, to } });
}

const clean = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ""));

/** Station names come as the railway writes them: "Biman_Bandar". */
export const stationLabel = (name) => String(name || "").replace(/_/g, " ");

export const STATUS_LABELS = {
  allocated: "Allocated",
  not_allocated: "Not allocated",
  not_checked: "Not checked",
};

/** The files applied, newest first: [{ kind, fileName, summary, scannedFrom, scannedTo, uploadedBy, uploadedAt }]. */
export async function fetchAllocationUploads(limit = 20) {
  const { data } = await api.get("/allocation/uploads", { params: { limit } });
  return data.uploads;
}

const DHAKA = "Asia/Dhaka";
const dayOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: DHAKA }).format(d);
const clock = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: DHAKA });
const dayText = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: DHAKA });

/** "21 Oct 2026, 09:40", in Dhaka time. */
export function when(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return `${dayText(d)}, ${clock(d)}`;
}

/** "22 Oct", or "22 Oct 2025" when not this year. */
export function shortDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const sameYear = dayOf(d).slice(0, 4) === dayOf(new Date()).slice(0, 4);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: DHAKA });
}

/** A span of times: "20 Oct 2026, 17:05–17:20" on one day, else both in full. */
export function span(fromIso, toIso) {
  if (!fromIso && !toIso) return null;
  if (!fromIso || !toIso || fromIso === toIso) return when(fromIso || toIso);
  const a = new Date(fromIso);
  const b = new Date(toIso);
  return dayOf(a) === dayOf(b) ? `${dayText(a)}, ${clock(a)}–${clock(b)}` : `${when(fromIso)} – ${when(toIso)}`;
}

/** Seats in a grid cell: 120, 1.2k, 12k — so the cell stays square. */
export function seatsText(n) {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/**
 * What one grid cell shows. A number in a cell is only ever seats.
 *
 * With a class chosen, that class's seats: ✓ while its count is not known, 0
 * when the census lists it but no seats are set aside, and the pair as not
 * allocated for that class when it is not listed. With none chosen, the seats
 * of every class added up — ✓ while none is counted, "80+" while some are not.
 *
 * `tone`: allocated (green), zero (amber), not_allocated (grey), not_checked.
 */
export function cellOf(pair, classCode) {
  const status = pair?.status || "not_checked";
  if (status !== "allocated") return { tone: status, text: "", note: null };
  if (classCode) {
    const c = pair.classes.find((x) => x.code === classCode);
    if (!c) return { tone: "not_allocated", text: "", note: `${classCode} not allocated` };
    if (c.seats === null) return { tone: "allocated", text: "✓", note: `${classCode}: count not available` };
    if (c.seats === 0) return { tone: "zero", text: "0", note: `${classCode}: no seats set aside` };
    return { tone: "allocated", text: seatsText(c.seats), note: `${classCode}: ${c.seats} seats` };
  }
  const counted = pair.classes.filter((c) => c.seats !== null);
  const total = counted.reduce((sum, c) => sum + c.seats, 0);
  const notCounted = pair.classes.length - counted.length;
  if (!counted.length) return { tone: "allocated", text: "✓", note: "counts not available" };
  if (!notCounted) {
    return total === 0
      ? { tone: "zero", text: "0", note: "no seats set aside" }
      : { tone: "allocated", text: seatsText(total), note: `${total} seats` };
  }
  if (total === 0) return { tone: "allocated", text: "✓", note: "counts not available for every class" };
  return {
    tone: "allocated",
    text: `${seatsText(total)}+`,
    note: `${total} seats counted, ${notCounted} class${notCounted === 1 ? "" : "es"} not counted`,
  };
}
