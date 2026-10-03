/**
 * The Android app (android/), when this page is running inside it.
 *
 * The app puts a `SeatPlannerApp` object on the page — for its own server's
 * origin only — and the page sends it JSON messages through `postMessage`.
 * In a browser there is no such object, and this returns null.
 */
export function androidApp() {
  if (typeof window === "undefined") return null;
  return typeof window.SeatPlannerApp?.postMessage === "function" ? window.SeatPlannerApp : null;
}

/** Whether the page is inside the app, from its user agent — usable before the page has loaded. */
export function inAndroidApp() {
  return typeof navigator !== "undefined" && /\bSeatPlannerApp\//.test(navigator.userAgent);
}

/** Send a message to the app. */
export function tellAndroidApp(message) {
  androidApp()?.postMessage(JSON.stringify(message));
}
