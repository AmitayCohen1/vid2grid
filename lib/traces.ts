/* ------------------------------------------------------------------
   The look of the traces: which joints leave a trail, how the trail is
   coloured and weighted, ribbons between joints, the ground it sits on.
   A pure canvas-2D painter — no React — so the plate on screen, the
   whole-phrase thumbnail and the PNG export all draw the same picture.
   Points are normalised image units (see lib/objects.ts); `map` turns
   them into pixels of whatever canvas is being painted.
   ------------------------------------------------------------------ */

import type { JointId } from "./skeleton";
import type { Points2D, Pt } from "./objects";

export type TraceGroup = "hands" | "feet" | "head" | "elbows" | "knees" | "hips";
export type Side = "l" | "r" | "c";

export const TRACE_GROUPS: { id: TraceGroup; label: string; joints: { id: JointId; side: Side }[] }[] = [
  { id: "hands", label: "Hands", joints: [{ id: "lwrist", side: "l" }, { id: "rwrist", side: "r" }] },
  { id: "feet", label: "Feet", joints: [{ id: "lankle", side: "l" }, { id: "rankle", side: "r" }] },
  { id: "head", label: "Head", joints: [{ id: "headTop", side: "c" }] },
  { id: "elbows", label: "Elbows", joints: [{ id: "lelbow", side: "l" }, { id: "relbow", side: "r" }] },
  { id: "knees", label: "Knees", joints: [{ id: "lknee", side: "l" }, { id: "rknee", side: "r" }] },
  { id: "hips", label: "Hips", joints: [{ id: "hipMid", side: "c" }] },
];

export type TraceColour = "sides" | "speed" | "time" | "ink";
export type TraceMark = "line" | "dots";
export type TraceRibbons = "off" | "pairs" | "web";
export type TraceGround = "night" | "paper";

export interface TraceStyle {
  groups: TraceGroup[];
  colour: TraceColour;
  /** The single colour used when `colour` is "ink". */
  ink: string;
  mark: TraceMark;
  /** Stroke weight in px on an 800 px-tall plate; scales with the plate. */
  weight: number;
  /** Weight follows the speed of the joint. */
  pulse: boolean;
  /** Smooth curves through the samples instead of straight segments. */
  curve: boolean;
  /** 0 = flat, 1 = a soft halo round every stroke. */
  glow: number;
  /** How much the tail of a trail fades out: 0 = none, 1 = to nothing. */
  fade: number;
  ribbons: TraceRibbons;
  /** A marker on the joint's current position. */
  dots: boolean;
  /** The ground behind the drawing when the video plate is off. */
  ground: TraceGround;
  /** How much the video plate is darkened so the drawing reads (0..1). */
  dim: number;
}

export const DEFAULT_TRACE_STYLE: TraceStyle = {
  groups: ["hands", "feet", "head"],
  colour: "sides",
  ink: "#f0b429",
  mark: "line",
  weight: 1.5,
  pulse: false,
  curve: false,
  glow: 0,
  fade: 0.85,
  ribbons: "off",
  dots: true,
  ground: "night",
  dim: 0.35,
};

/** A few looks to start from. */
export const TRACE_PRESETS: { name: string; hint: string; style: Partial<TraceStyle> }[] = [
  { name: "Plate", hint: "The analytic default: thin trails on the dimmed picture.", style: DEFAULT_TRACE_STYLE },
  { name: "Neon", hint: "Glowing, speed-coloured, pulsing with the movement.", style: { colour: "speed", pulse: true, glow: 0.7, curve: true, weight: 2, fade: 0.9, ground: "night" } },
  { name: "Etching", hint: "One ink on paper, every joint, no fade.", style: { colour: "ink", ink: "#14161b", groups: ["hands", "feet", "head", "elbows", "knees"], weight: 0.7, curve: true, fade: 0, dots: false, ground: "paper", ribbons: "pairs", glow: 0 } },
  { name: "Strings", hint: "Ribbons stretched between the hands and the feet.", style: { ribbons: "web", colour: "time", weight: 0.8, curve: true, fade: 0.5, dots: false, glow: 0 } },
  { name: "Pointillist", hint: "A dot per frame, sized by speed.", style: { mark: "dots", pulse: true, weight: 2.5, colour: "sides", fade: 0.6, dots: false, glow: 0.2 } },
];

export const GROUND: Record<TraceGround, string> = { night: "#0b0c0f", paper: "#f4f1ea" };

export interface TraceMap {
  X: (u: number) => number;
  Y: (v: number) => number;
  /** Plate height / 800: stroke weights are specified for an 800 px plate. */
  scale: number;
}

const SIDES: Record<TraceGround, Record<Side, string>> = {
  night: { l: "#4cc9f0", r: "#f72585", c: "#e8e9ec" },
  paper: { l: "#177fa6", r: "#c22079", c: "#2b2b2b" },
};

const HEAT: Record<TraceGround, [number, number, number][]> = {
  night: [[42, 75, 141], [76, 201, 240], [247, 247, 160], [255, 255, 255]],
  paper: [[28, 46, 107], [23, 127, 166], [224, 119, 26], [196, 58, 36]],
};

function ramp(stops: [number, number, number][], t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const a = stops[i], b = stops[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

/** Speed of a joint between two samples, in image-height units per frame. */
function speed(a: Pt, b: Pt, aspect: number): number {
  return Math.hypot((b[0] - a[0]) * aspect, b[1] - a[1]);
}

export function traceJoints(style: TraceStyle): { id: JointId; side: Side; group: TraceGroup }[] {
  return TRACE_GROUPS.filter((g) => style.groups.includes(g.id)).flatMap((g) => g.joints.map((j) => ({ ...j, group: g.id })));
}

export interface PaintTracesArgs {
  frames: (Points2D | null)[];
  /** First and current frame of the trail (inclusive). */
  from: number;
  to: number;
  aspect: number;
  style: TraceStyle;
  map: TraceMap;
  ground: TraceGround;
}

/** Colour of one sample of a trail. */
function colourAt(style: TraceStyle, ground: TraceGround, side: Side, i: number, n: number, sp: number): string {
  switch (style.colour) {
    case "speed": return ramp(HEAT[ground], sp * 25);
    case "time": return `hsl(${Math.round((i / Math.max(1, n - 1)) * 300)} 80% ${ground === "paper" ? 42 : 66}%)`;
    case "ink": return style.ink;
    default: return SIDES[ground][side];
  }
}

/** Draw the trails (and ribbons, and position dots) of every traced joint. */
export function paintTraces(ctx: CanvasRenderingContext2D, a: PaintTracesArgs) {
  const { frames, from, to, aspect, style, map, ground } = a;
  const span = Math.max(1, to - from);
  const n = frames.length;
  const joints = traceJoints(style);
  const alpha = (i: number) => { const t = (i - from) / span; return (1 - style.fade) + style.fade * t * t; };
  const width = (sp: number) => style.weight * map.scale * (style.pulse ? 0.35 + Math.min(2.6, sp * 55) : 1);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Ribbons first, underneath the trails.
  if (style.ribbons !== "off") {
    const pairs: [typeof joints[number], typeof joints[number]][] = [];
    for (let i = 0; i < joints.length; i++) for (let j = i + 1; j < joints.length; j++) {
      if (style.ribbons === "web" || joints[i].group === joints[j].group) pairs.push([joints[i], joints[j]]);
    }
    ctx.lineWidth = Math.max(0.4, style.weight * map.scale * 0.45);
    for (let i = from; i <= to; i++) {
      const f = frames[i];
      if (!f) continue;
      const prev = frames[i - 1];
      for (const [p, q] of pairs) {
        const u = f[p.id], v = f[q.id];
        if (!u || !v) continue;
        const spu = prev?.[p.id] ? speed(prev[p.id]!, u, aspect) : 0, spv = prev?.[q.id] ? speed(prev[q.id]!, v, aspect) : 0;
        const cu = colourAt(style, ground, p.side, i, n, spu), cv = colourAt(style, ground, q.side, i, n, spv);
        const x0 = map.X(u[0]), y0 = map.Y(u[1]), x1 = map.X(v[0]), y1 = map.Y(v[1]);
        if (cu === cv) ctx.strokeStyle = cu;
        else { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, cu); g.addColorStop(1, cv); ctx.strokeStyle = g; }
        ctx.globalAlpha = alpha(i) * (style.ribbons === "web" ? 0.22 : 0.32);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
  }

  ctx.shadowBlur = style.glow > 0 ? style.glow * 18 * map.scale : 0;

  for (const { id, side } of joints) {
    // Runs of consecutive tracked samples; a gap in tracking breaks the line.
    let run: number[] = [];
    const flush = () => { if (run.length) drawRun(run); run = []; };
    for (let i = from; i <= to; i++) { if (frames[i]?.[id]) run.push(i); else flush(); }
    flush();

    function drawRun(idx: number[]) {
      const P = idx.map((i) => frames[i]![id]!);
      const px = P.map((p) => [map.X(p[0]), map.Y(p[1])] as Pt);
      const sp = P.map((p, k) => (k ? speed(P[k - 1], p, aspect) : 0));
      if (style.mark === "dots") {
        for (let k = 0; k < P.length; k++) {
          const c = colourAt(style, ground, side, idx[k], n, sp[k]);
          ctx.fillStyle = c; ctx.shadowColor = c;
          ctx.globalAlpha = alpha(idx[k]);
          ctx.beginPath(); ctx.arc(px[k][0], px[k][1], Math.max(0.4, width(sp[k]) * 0.8), 0, Math.PI * 2); ctx.fill();
        }
        return;
      }
      if (P.length < 2) return;
      for (let k = 1; k < P.length; k++) {
        const c = colourAt(style, ground, side, idx[k], n, sp[k]);
        ctx.strokeStyle = c; ctx.shadowColor = c;
        ctx.globalAlpha = alpha(idx[k]);
        ctx.lineWidth = Math.max(0.3, width(sp[k]));
        ctx.beginPath();
        if (style.curve && P.length > 2) {
          // Segment k runs between the midpoints either side of sample k, bending through it;
          // the first and last half-segments are straight.
          const m0 = k === 1 ? px[0] : mid(px[k - 1], px[k]);
          if (k === P.length - 1) { ctx.moveTo(m0[0], m0[1]); ctx.lineTo(px[k][0], px[k][1]); }
          else { const m1 = mid(px[k], px[k + 1]); ctx.moveTo(m0[0], m0[1]); ctx.quadraticCurveTo(px[k][0], px[k][1], m1[0], m1[1]); }
        } else {
          ctx.moveTo(px[k - 1][0], px[k - 1][1]); ctx.lineTo(px[k][0], px[k][1]);
        }
        ctx.stroke();
      }
    }
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  if (style.dots) {
    const cur = frames[to], prev = frames[to - 1];
    for (const { id, side } of joints) {
      const p = cur?.[id];
      if (!p) continue;
      const sp = prev?.[id] ? speed(prev[id]!, p, aspect) : 0;
      ctx.fillStyle = colourAt(style, ground, side, to, n, sp);
      ctx.beginPath(); ctx.arc(map.X(p[0]), map.Y(p[1]), Math.max(2, 3 * map.scale), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function mid(a: Pt, b: Pt): Pt { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
