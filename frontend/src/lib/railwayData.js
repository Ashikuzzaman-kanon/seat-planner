import api from "@/lib/api";

/**
 * The real railway: Bangladesh Railway's timetable and the seat plans
 * transcribed for its trains. Loading runs as a background job; the screen
 * follows it with `followJob`.
 */

export async function fetchRailwayStatus() {
  const { data } = await api.get("/railway-data");
  return data;
}

export async function loadRailway() {
  const { data } = await api.post("/railway-data/load");
  return data;
}

/** "Daily", "Daily except Saturday", or "Sun, Tue, Thu". */
export function runsOnLabel(days = []) {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (days.length === 7) return "Daily";
  if (days.length === 6) return `Except ${names[[0, 1, 2, 3, 4, 5, 6].find((d) => !days.includes(d))]}`;
  return days.map((d) => names[d].slice(0, 3)).join(", ") || "Never";
}
