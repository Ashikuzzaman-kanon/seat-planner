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
export async function uploadAllocation(kind, text, apply = false) {
  const { data } = await api.post(`/allocation/import/${kind}`, text, {
    params: apply ? { apply: 1 } : {},
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
