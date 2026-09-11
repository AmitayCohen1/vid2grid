/* ------------------------------------------------------------------
   Formations: where everyone stands, and when they move.

   A formation is a shape (a line, a column, a V, a circle…) filled by
   the dancers in roster order — the lead first, then the cast — at a
   spacing in metres, facing the audience, the centre, or outwards. A
   *cue* pins a formation to a moment of the stage clock; between cues
   every dancer walks (eased, over `transition` seconds) from the slot
   they held to the next. Before the first cue the first formation holds;
   after the last, the last. Placements are floor offsets in the same
   terms as a cast member's Across / Depth / Turn, so they bake into a
   pose through `placePose` like any other placement.

   Pure: no React, no three.js. App.tsx samples `placementsAt` per frame.
   ------------------------------------------------------------------ */

export type Shape = "line" | "column" | "diagonal" | "vee" | "circle" | "pairs" | "cluster";
export type Facing = "audience" | "centre" | "outward";

export interface Placement { x: number; z: number; rot: number }

export interface Cue {
  id: string;
  /** Stage seconds this formation is reached. */
  at: number;
  shape: Shape;
  /** Metres between neighbours. */
  spacing: number;
  facing: Facing;
}

export const SHAPES: { id: Shape; label: string; hint: string }[] = [
  { id: "line", label: "Line", hint: "Shoulder to shoulder across the stage." },
  { id: "column", label: "Column", hint: "One behind the other, the lead in front." },
  { id: "diagonal", label: "Diagonal", hint: "From down-left to up-right." },
  { id: "vee", label: "V", hint: "A wedge with the lead at its point." },
  { id: "circle", label: "Circle", hint: "A ring; the lead nearest the audience." },
  { id: "pairs", label: "Two lines", hint: "Two staggered rows." },
  { id: "cluster", label: "Cluster", hint: "Close together at the centre." },
];

export const FACINGS: { id: Facing; label: string }[] = [
  { id: "audience", label: "Audience" },
  { id: "centre", label: "Centre" },
  { id: "outward", label: "Outward" },
];

export const DEFAULT_SPACING = 1.2;
/** Seconds a walk between formations takes, by default. */
export const DEFAULT_TRANSITION = 2;

/** Floor positions of a shape for `n` dancers, centred on the stage; index 0 is the lead. */
export function shapeSlots(shape: Shape, n: number, spacing: number): { x: number; z: number }[] {
  if (n <= 0) return [];
  const s = Math.max(0.2, spacing);
  let out: { x: number; z: number }[];
  switch (shape) {
    case "line":
      out = Array.from({ length: n }, (_, i) => ({ x: fan(i) * s, z: 0 }));
      break;
    case "column":
      // The lead downstage (+z), the rest behind in order.
      out = Array.from({ length: n }, (_, i) => ({ x: 0, z: -i * s }));
      break;
    case "diagonal":
      out = Array.from({ length: n }, (_, i) => ({ x: fan(i) * s * 0.75, z: fan(i) * s * 0.75 }));
      break;
    case "vee":
      // The lead at the point, downstage; pairs open behind, left then right.
      out = Array.from({ length: n }, (_, i) => { const k = Math.ceil(i / 2); return { x: fan(i) * s * 0.8, z: -k * s * 0.7 }; });
      break;
    case "circle": {
      if (n === 1) { out = [{ x: 0, z: 0 }]; break; }
      const r = Math.max(s * 0.8, (n * s) / (2 * Math.PI));
      // The lead nearest the audience (+z); the others round the ring, fanning out so neighbours stay neighbours.
      out = Array.from({ length: n }, (_, i) => { const a = (fan(i) / n) * 2 * Math.PI; return { x: Math.sin(a) * r, z: Math.cos(a) * r }; });
      return out; // a ring is already centred
    }
    case "pairs":
      // Two staggered rows, the lead in the front row.
      out = Array.from({ length: n }, (_, i) => { const row = i % 2, col = Math.floor(i / 2); return { x: fan(col) * s + (row ? s / 2 : 0), z: row ? -s * 0.5 : s * 0.5 }; });
      break;
    case "cluster":
      // A sunflower spiral: the lead at the heart, the rest packed close around.
      out = Array.from({ length: n }, (_, i) => { const r = 0.5 * s * Math.sqrt(i), a = i * 2.39996; return { x: Math.sin(a) * r, z: Math.cos(a) * r }; });
      break;
  }
  // Centre the shape on the stage.
  const cx = out.reduce((a, p) => a + p.x, 0) / n, cz = out.reduce((a, p) => a + p.z, 0) / n;
  return out.map((p) => ({ x: p.x - cx, z: p.z - cz }));
}

/** Fan out from the lead: 0, −1, +1, −2, +2 … so later dancers join at the edges. */
const fan = (i: number) => (i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? -1 : 1));

/** The floor rotation (degrees, as a cast member's Turn) for a dancer at (x, z) under a facing rule. */
export function facingRot(facing: Facing, x: number, z: number): number {
  if (facing === "audience") return 0;
  if (Math.hypot(x, z) < 1e-6) return 0;
  // A dancer faces +z at rot 0; forward = (sin φ, cos φ). Turn to face the centre (−x, −z) or away.
  const toCentre = (Math.atan2(-x, -z) * 180) / Math.PI;
  return facing === "centre" ? toCentre : ((toCentre + 360) % 360) - 180;
}

/** Every dancer's placement in a formation. */
export function formationPlacements(cue: Pick<Cue, "shape" | "spacing" | "facing">, n: number): Placement[] {
  return shapeSlots(cue.shape, n, cue.spacing).map(({ x, z }) => ({ x: round(x), z: round(z), rot: round(facingRot(cue.facing, x, z)) }));
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const lerpAngle = (a: number, b: number, u: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * u;

/**
 * Where everyone stands at stage time `t`: the cues sorted by time, each
 * dancer easing from the previous formation into the next over
 * `transition` seconds ending at the cue. With no cues, nobody is placed
 * (the caller keeps its own placements).
 */
export function placementsAt(cues: Cue[], n: number, t: number, transition = DEFAULT_TRANSITION): Placement[] | null {
  if (!cues.length || n <= 0) return null;
  const sorted = [...cues].sort((a, b) => a.at - b.at);
  let prev = sorted[0], next = sorted[0];
  for (const c of sorted) { if (c.at <= t) prev = c; else { next = c; break; } next = c; }
  const from = formationPlacements(prev, n);
  if (next === prev) return from;
  const to = formationPlacements(next, n);
  const span = Math.max(1e-3, Math.min(transition, next.at - prev.at));
  const u = Math.max(0, Math.min(1, (t - (next.at - span)) / span));
  if (u <= 0) return from;
  if (u >= 1) return to;
  const e = ease(u);
  return from.map((a, i) => ({
    x: round(a.x + (to[i].x - a.x) * e),
    z: round(a.z + (to[i].z - a.z) * e),
    rot: round(lerpAngle(a.rot, to[i].rot, e)),
  }));
}

/** Round stored cues into usable ones — missing or bad fields fall back, ids are kept. */
export function sanitizeCues(raw: unknown): Cue[] {
  if (!Array.isArray(raw)) return [];
  const shapes = new Set(SHAPES.map((s) => s.id)), facings = new Set(FACINGS.map((f) => f.id));
  return raw.filter((c): c is Cue => !!c && typeof c === "object" && typeof (c as Cue).id === "string" && Number.isFinite((c as Cue).at))
    .map((c) => ({
      id: c.id,
      at: Math.max(0, Math.min(3600, c.at)),
      shape: shapes.has(c.shape) ? c.shape : "line",
      spacing: Number.isFinite(c.spacing) ? Math.max(0.3, Math.min(4, c.spacing)) : DEFAULT_SPACING,
      facing: facings.has(c.facing) ? c.facing : "audience",
    }));
}
