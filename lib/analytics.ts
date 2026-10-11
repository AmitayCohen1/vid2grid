/* Product analytics from the browser: `track("dance_ready", { seconds: 8 })`.
   Each event goes to two places: Vercel Analytics (custom events, dashboard on
   vercel.com) and our own store via /api/track (the /admin page). Events are
   batched and sent with a beacon when the page is hidden, so tracking never
   competes with the tracker for the main thread. An anonymous visitor id lives in
   localStorage and a session id in sessionStorage; nothing identifies a person,
   and props must never carry anything a dancer made (lib/events.ts enforces flat primitives). */
import { track as vercelTrack } from "@vercel/analytics";
import { MAX_BATCH, type ClientEvent, type EventProps } from "./events";

const ENDPOINT = "/api/track";
const FLUSH_MS = 4000;
const queue: ClientEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let wired = false;
const sent = new Set<string>();

function id(store: Storage | undefined, key: string): string {
  try {
    const have = store?.getItem(key);
    if (have) return have;
    const fresh = crypto.randomUUID();
    store?.setItem(key, fresh);
    return fresh;
  } catch { return crypto.randomUUID(); }
}

function send(beacon: boolean) {
  if (timer) { clearTimeout(timer); timer = null; }
  while (queue.length) {
    const events = queue.splice(0, MAX_BATCH);
    const body = JSON.stringify({
      visitor: id(globalThis.localStorage, "vid2grid:visitor"),
      session: id(globalThis.sessionStorage, "vid2grid:session"),
      referrer: document.referrer && new URL(document.referrer).host !== location.host ? document.referrer : undefined,
      events,
    });
    const blob = new Blob([body], { type: "application/json" });
    if (beacon && navigator.sendBeacon?.(ENDPOINT, blob)) continue;
    void fetch(ENDPOINT, { method: "POST", body: blob, keepalive: true }).catch(() => {});
  }
}

function wire() {
  if (wired) return;
  wired = true;
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") send(true); });
  addEventListener("pagehide", () => send(true));
}

/** `once`: at most one per page load (e.g. app_open, which React may run twice). */
export function track(name: string, props: EventProps = {}, { once = false } = {}) {
  if (typeof window === "undefined") return;
  if (once) { if (sent.has(name)) return; sent.add(name); }
  try { vercelTrack(name, props); } catch { /* analytics must never break the app */ }
  wire();
  queue.push({ name, props, path: location.pathname, t: Date.now() });
  if (queue.length >= MAX_BATCH) send(false);
  else if (!timer) timer = setTimeout(() => send(false), FLUSH_MS);
}
