import api from "@/lib/api";

/**
 * Demo data: fill the system with demonstration accounts, trains, departures
 * and bookings, and remove exactly that again. Both run as background jobs;
 * the screen follows them with `followJob`.
 */

export async function fetchDemoStatus() {
  const { data } = await api.get("/demo-data");
  return data;
}

export async function populateDemo() {
  const { data } = await api.post("/demo-data/populate");
  return data;
}

export async function clearDemo() {
  const { data } = await api.post("/demo-data/clear");
  return data;
}

/** The counts on the status card, in the order they are shown. */
export const DEMO_COUNT_LABELS = [
  ["accounts", "Accounts", "pi pi-users"],
  ["roles", "Roles", "pi pi-shield"],
  ["seatPlans", "Seat plans", "pi pi-th-large"],
  ["stations", "Stations", "pi pi-map-marker"],
  ["trains", "Trains", "pi pi-directions"],
  ["fareRules", "Fare rules", "pi pi-money-bill"],
  ["departures", "Departures", "pi pi-calendar"],
  ["bookings", "Bookings", "pi pi-bookmark"],
  ["tickets", "Tickets", "pi pi-ticket"],
];

/** What a populate run created, by model, said in words — the main things only. */
const CREATED_LABELS = [
  ["User", "account"],
  ["Role", "role"],
  ["SeatPlan", "seat plan"],
  ["Station", "station"],
  ["TrainName", "train"],
  ["Trip", "departure"],
  ["Booking", "booking"],
  ["Ticket", "ticket"],
  ["Refund", "return"],
];

export function createdSummary(created = {}, seats = 0) {
  const parts = CREATED_LABELS.filter(([model]) => created[model]).map(
    ([model, word]) => `${created[model]} ${word}${created[model] === 1 ? "" : "s"}`
  );
  if (seats) parts.splice(parts.findIndex((p) => /departure/.test(p)) + 1 || parts.length, 0, `${seats} seats`);
  return parts.join(" · ");
}

export const ACCOUNT_STATE = {
  demo: { label: "Created by the demo", severity: "success" },
  existing: { label: "Already existed", severity: "warning" },
  missing: { label: "Not created yet", severity: "secondary" },
};

/** Role names as people read them. */
export const ROLE_LABELS = { user: "Passenger", planner: "Planner", admin: "Admin", checker: "Ticket checker" };
