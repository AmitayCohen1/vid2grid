/* Product analytics events: the shape the browser sends to /api/track and the
   rules the server holds it to. Pure, so test/events.test.ts can pin it down.
   Props are flat primitives only (also what Vercel Analytics accepts), and never
   anything a dancer made: no file names, no poses, no pictures. */

export type EventProps = Record<string, string | number | boolean | null>;
export type ClientEvent = { name: string; props?: EventProps; path?: string; t?: number };
export type EventBatch = { visitor: string; session: string; referrer?: string; events: ClientEvent[] };
export type EventRow = { name: string; visitor: string; session: string; path: string | null; props: EventProps; referrer: string | null; ts: string };

export const MAX_BATCH = 25;
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_PROPS = 12;
const MAX_STR = 120;
const SKEW_MS = 10 * 60_000;

const clip = (s: unknown, n: number) => (typeof s === "string" && s ? s.slice(0, n) : null);

function cleanProps(p: unknown): EventProps {
  const out: EventProps = {};
  if (!p || typeof p !== "object" || Array.isArray(p)) return out;
  for (const [k, v] of Object.entries(p).slice(0, MAX_PROPS)) {
    if (!NAME.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, MAX_STR);
    else if (typeof v === "number") { if (Number.isFinite(v)) out[k] = v; }
    else if (typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

/** The rows worth keeping from an untrusted batch; `null` when the batch itself is malformed. */
export function sanitizeBatch(body: unknown, now = Date.now()): EventRow[] | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Partial<EventBatch>;
  if (typeof b.visitor !== "string" || !ID.test(b.visitor)) return null;
  if (typeof b.session !== "string" || !ID.test(b.session)) return null;
  if (!Array.isArray(b.events)) return null;
  const referrer = clip(b.referrer, 200);
  const rows: EventRow[] = [];
  for (const e of b.events.slice(0, MAX_BATCH)) {
    if (!e || typeof e !== "object" || typeof e.name !== "string" || !NAME.test(e.name)) continue;
    // The client's clock orders a batch, but it may not move an event far from when it arrived.
    const t = typeof e.t === "number" && Math.abs(e.t - now) < SKEW_MS ? e.t : now;
    const path = clip(e.path, 200);
    rows.push({ name: e.name, visitor: b.visitor, session: b.session, path: path?.startsWith("/") ? path : null, props: cleanProps(e.props), referrer, ts: new Date(t).toISOString() });
  }
  return rows;
}

/** A coarse device + browser from a user agent; `null` device for bots and headless browsers. */
export function describeAgent(ua: string): { device: string | null; browser: string } {
  if (!ua || /bot|crawl|spider|headless|lighthouse|preview|curl|wget|python-requests/i.test(ua)) return { device: null, browser: "bot" };
  const device = /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua) ? "tablet" : /Mobi|iPhone|Android/i.test(ua) ? "mobile" : "desktop";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
  return { device, browser };
}
