import api from "@/lib/api";

/**
 * Seat Allocation for everyone (/seat-allocation), without signing in.
 *
 * Every request carries a random id this browser keeps (to count its free
 * searches, nothing else), the pass from the bot check when there is one,
 * and the page the visitor came from. Signed in, the usual session goes too,
 * and the searches are unlimited.
 */
const VISITOR_KEY = "sp_visitor";
const PASS_KEY = "sp_public_pass";
const REFERRER_KEY = "sp_public_referrer";

let memoryVisitor = null;

const randomId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

/** This browser's random id: made once, kept. */
export function visitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id || !/^[A-Za-z0-9-]{16,64}$/.test(id)) {
      id = randomId();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    memoryVisitor ||= randomId();
    return memoryVisitor;
  }
}

/** Where the visitor came from (Facebook, a search…), remembered for the visit. */
function referrer() {
  try {
    let ref = sessionStorage.getItem(REFERRER_KEY);
    if (ref === null) {
      const r = document.referrer || "";
      ref = r && !r.startsWith(window.location.origin) ? r.slice(0, 300) : "";
      sessionStorage.setItem(REFERRER_KEY, ref);
    }
    return ref;
  } catch {
    return "";
  }
}

/** The bot check's pass, while it lasts. */
export function currentPass() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PASS_KEY) || "null");
    return saved && new Date(saved.expiresAt).getTime() > Date.now() + 30_000 ? saved.pass : null;
  } catch {
    return null;
  }
}

function headers() {
  const pass = currentPass();
  const ref = referrer();
  return {
    "x-sp-visitor": visitorId(),
    ...(pass ? { "x-sp-pass": pass } : {}),
    ...(ref ? { "x-sp-referrer": ref } : {}),
  };
}

/** { enabled, botCheck: { siteKey } | null } — whether the page is open at all. */
export async function publicStatus() {
  const { data } = await api.get("/public/allocation/status", { headers: headers() });
  return data;
}

/** The filters, how current the data is, and whether a bot check is needed. */
export async function publicMeta() {
  const { data } = await api.get("/public/allocation/meta", { headers: headers() });
  return data;
}

/** A search: the same answer as in the app. */
export async function publicList(params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  const { data } = await api.get("/public/allocation", { params: clean, headers: headers() });
  return data;
}

/** Trade the bot check's answer for a pass, kept for the visit. */
export async function publicPass(token) {
  const { data } = await api.post("/public/allocation/pass", { token }, { headers: headers() });
  try {
    if (data.pass) sessionStorage.setItem(PASS_KEY, JSON.stringify({ pass: data.pass, expiresAt: data.expiresAt }));
  } catch {
    /* without storage, the next search asks again */
  }
  return data;
}
