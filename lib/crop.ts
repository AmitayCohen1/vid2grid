/* ------------------------------------------------------------------
   Crop: the region of the source video that is *the* video as far as
   the rest of the pipeline is concerned. Everything downstream — the
   tracker, the image landmarks, the aspect used for lifting, the
   overlay, the traces — sees the crop as the whole frame, so a dancer
   who is small in a wide shot can be tracked and watched close up.

   A crop is stored as fractions of the full frame (0..1), so it is
   independent of the video's pixel size.
   ------------------------------------------------------------------ */

export interface Crop {
  /** Left / top edge as a fraction of the full frame. */
  x: number;
  y: number;
  /** Width / height as a fraction of the full frame. */
  w: number;
  h: number;
}

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };

/** Smallest crop allowed, as a fraction of the frame on either axis. */
export const MIN_CROP = 0.1;

/** Zoom the crop represents: 1 = full frame, 4 = a quarter of the frame across. */
export function cropZoom(c: Crop): number {
  return 1 / Math.max(MIN_CROP, Math.max(c.w, c.h));
}

export function isFullCrop(c: Crop | null | undefined): boolean {
  return !c || (c.x <= 0 && c.y <= 0 && c.w >= 1 && c.h >= 1);
}

/** Keep a crop inside the frame and at least MIN_CROP on each side. */
export function clampCrop(c: Crop): Crop {
  const w = Math.min(1, Math.max(MIN_CROP, c.w));
  const h = Math.min(1, Math.max(MIN_CROP, c.h));
  const x = Math.min(1 - w, Math.max(0, c.x));
  const y = Math.min(1 - h, Math.max(0, c.y));
  return { x, y, w, h };
}

/**
 * Scale the crop about a point (fractions of the frame) so that it shows
 * the frame at `zoom` — the box keeps the frame's aspect, the anchor stays
 * put on screen. Used by the zoom slider and the scroll wheel.
 */
export function zoomCrop(c: Crop, zoom: number, anchor: { x: number; y: number } = { x: c.x + c.w / 2, y: c.y + c.h / 2 }): Crop {
  const z = Math.min(1 / MIN_CROP, Math.max(1, zoom));
  const w = 1 / z, h = 1 / z;
  // Where the anchor sits inside the old box, kept as the same fraction of the new one.
  const fx = c.w > 0 ? (anchor.x - c.x) / c.w : 0.5;
  const fy = c.h > 0 ? (anchor.y - c.y) / c.h : 0.5;
  return clampCrop({ x: anchor.x - fx * w, y: anchor.y - fy * h, w, h });
}

/** Move the crop by a delta (fractions of the frame), staying in the frame. */
export function moveCrop(c: Crop, dx: number, dy: number): Crop {
  return clampCrop({ ...c, x: c.x + dx, y: c.y + dy });
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Drag one edge or corner of the crop by a delta (fractions of the frame). */
export function resizeCrop(c: Crop, handle: Handle, dx: number, dy: number): Crop {
  let { x, y, w, h } = c;
  const right = x + w, bottom = y + h;
  if (handle.includes("w")) x = Math.min(right - MIN_CROP, Math.max(0, x + dx));
  if (handle.includes("e")) w = Math.min(1 - x, Math.max(MIN_CROP, w + dx));
  if (handle.includes("n")) y = Math.min(bottom - MIN_CROP, Math.max(0, y + dy));
  if (handle.includes("s")) h = Math.min(1 - y, Math.max(MIN_CROP, h + dy));
  if (handle.includes("w")) w = right - x;
  if (handle.includes("n")) h = bottom - y;
  return clampCrop({ x, y, w, h });
}

/**
 * A crop around a set of normalised image points (x, y, visibility
 * triples, as the tracker emits), padded by `margin` of the box's size on
 * every side. Points below `minVis` are ignored. Returns null when there is
 * nothing to fit.
 */
export function fitCropToPoints(points: ArrayLike<number>, margin = 0.2, minVis = 0.5): Crop | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (let i = 0; i + 2 < points.length; i += 3) {
    if (points[i + 2] < minVis) continue;
    const px = points[i], py = points[i + 1];
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    n++;
  }
  if (n < 2) return null;
  const w = x1 - x0, h = y1 - y0;
  // Pad by the larger side so a standing figure gets room to reach sideways.
  const pad = Math.max(w, h) * margin;
  return clampCrop({ x: x0 - pad, y: y0 - pad, w: w + 2 * pad, h: h + 2 * pad });
}

/** The crop's size in source pixels, for canvases and the SourceInfo. */
export function cropPixels(c: Crop, videoWidth: number, videoHeight: number): { x: number; y: number; w: number; h: number } {
  const x = Math.round(c.x * videoWidth), y = Math.round(c.y * videoHeight);
  const w = Math.max(1, Math.round(c.w * videoWidth)), h = Math.max(1, Math.round(c.h * videoHeight));
  return { x, y, w: Math.min(w, videoWidth - x), h: Math.min(h, videoHeight - y) };
}

/** Is this value a well-formed crop (for score files)? */
export function isCrop(v: unknown): v is Crop {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  const f = (k: string) => typeof c[k] === "number" && Number.isFinite(c[k] as number);
  if (!f("x") || !f("y") || !f("w") || !f("h")) return false;
  const { x, y, w, h } = c as unknown as Crop;
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.0001 && y + h <= 1.0001;
}
