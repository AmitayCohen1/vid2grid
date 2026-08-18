/* ------------------------------------------------------------------
   The grid — the source of truth.

   A raw direction is continuous; a *notated* direction lives on a
   discrete sphere grid: azimuth in steps of `azStep`, elevation in
   steps of `elStep`. The Score is stored snapped to this grid; the
   traditional notations (Laban's 8 directions × 3 levels, Eshkol-
   Wachman's 45° units) are read off it.
   ------------------------------------------------------------------ */

import { type AzEl, angleDiff, clamp, wrap360 } from "./geometry";

export interface GridConfig {
  /** Azimuth step in degrees; 360 must be a multiple. Default 22.5. */
  azStep: number;
  /** Elevation step in degrees; 90 must be a multiple. Default 22.5. */
  elStep: number;
  /** Fraction of a step a raw value must cross past a cell boundary before the cell changes. */
  hysteresis: number;
  /** Minimum frames a new cell must persist before it is accepted. */
  minDwell: number;
  /** Facing step in degrees. */
  facingStep: number;
}

export const DEFAULT_GRID: GridConfig = {
  azStep: 22.5,
  elStep: 22.5,
  hysteresis: 0.3,
  minDwell: 4,
  facingStep: 45,
};

/** A grid cell as integer indices: az index (0..N-1) and el index (-M..M). */
export type Cell = [ai: number, ei: number];

export const cellCounts = (g: GridConfig) => ({
  az: Math.round(360 / g.azStep),
  el: Math.round(90 / g.elStep),
});

/** Nearest cell for a raw direction. Near the poles azimuth is meaningless; keep it anyway. */
export function nearestCell(g: GridConfig, [az, el]: AzEl): Cell {
  const n = cellCounts(g);
  const ai = ((Math.round(az / g.azStep) % n.az) + n.az) % n.az;
  const ei = clamp(Math.round(el / g.elStep), -n.el, n.el);
  return [ai, ei];
}

export function cellToAzEl(g: GridConfig, [ai, ei]: Cell): AzEl {
  return [wrap360(ai * g.azStep), clamp(ei * g.elStep, -90, 90)];
}

/**
 * Snap with hysteresis: stay in `prev` unless the raw value has moved more
 * than (0.5 + hysteresis) steps away from the previous cell's centre.
 * Elevation near a pole makes azimuth irrelevant, so azimuth is held there.
 */
export function snapCell(g: GridConfig, prev: Cell | null, raw: AzEl): Cell {
  const near = nearestCell(g, raw);
  if (!prev) return near;
  const [paz, pel] = cellToAzEl(g, prev);
  const limitAz = g.azStep * (0.5 + g.hysteresis);
  const limitEl = g.elStep * (0.5 + g.hysteresis);
  const ei = Math.abs(raw[1] - pel) > limitEl ? near[1] : prev[1];
  const n = cellCounts(g);
  // At the pole azimuth is meaningless: pin it to 0 so the cell is canonical.
  if (Math.abs(ei) === n.el) return [0, ei];
  // Near the pole small horizontal wobbles swing azimuth wildly; hold the last one.
  const nearPole = Math.abs(raw[1]) > 90 - g.elStep * 0.6;
  const ai = !nearPole && Math.abs(angleDiff(paz, raw[0])) > limitAz ? near[0] : prev[0];
  return [ai, ei];
}

export const sameCell = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

export function snapAngle(step: number, deg: number): number {
  return wrap360(Math.round(deg / step) * step);
}

/* ---------- Readings in the historical notations ---------- */

export type LabanDir = "place" | "forward" | "right-forward" | "right" | "right-back" | "back" | "left-back" | "left" | "left-forward";
export type LabanLevel = "low" | "middle" | "high";

const LABAN_DIRS: LabanDir[] = ["forward", "right-forward", "right", "right-back", "back", "left-back", "left", "left-forward"];
export const LABAN_ARROW: Record<LabanDir, string> = {
  place: "●", forward: "↑", "right-forward": "↗", right: "→", "right-back": "↘",
  back: "↓", "left-back": "↙", left: "←", "left-forward": "↖",
};

/** Laban: 8 horizontal directions × low/middle/high; straight up or down is "place". */
export function laban([az, el]: AzEl): { dir: LabanDir; level: LabanLevel } {
  const level: LabanLevel = el > 22.5 ? "high" : el < -22.5 ? "low" : "middle";
  if (Math.abs(el) > 67.5) return { dir: "place", level };
  const dir = LABAN_DIRS[Math.round(wrap360(az) / 45) % 8];
  return { dir, level };
}

/**
 * Eshkol-Wachman: positions on a sphere in 45° units. Horizontal 0..7 going
 * clockwise from forward; vertical 0 (down) .. 2 (level) .. 4 (up), with
 * quarter-unit refinement written as a decimal.
 */
export function eshkolWachman([az, el]: AzEl): { h: number; v: number; text: string } {
  const h = (wrap360(az) / 45) % 8;
  const v = (el + 90) / 45;
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return { h, v, text: `(${f(round4(h))}, ${f(round4(v))})` };
}
const round4 = (n: number) => Math.round(n * 4) / 4;

/** Short human phrase for a direction: "right-forward, high (22°)". */
export function describe(d: AzEl): string {
  const l = laban(d);
  return l.dir === "place" ? `${d[1] > 0 ? "up" : "down"}` : `${l.dir}, ${l.level}`;
}
