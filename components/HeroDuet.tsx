"use client";

/* ------------------------------------------------------------------
   The landing hero: a real clip, its tracking, and a character dancing
   the score on the studio's own stage.

   `/demo/gal.json` is the app's own output for `/demo/gal.mp4`
   (poses, body, the tracker's 2D landmarks per frame — produced by
   scripts/hero-data.ts through lib/tracker → lib/score). The picture
   sits at the left with the landmarks drawn over it exactly as the
   studio's Side by side view does; beside it the studio Stage (grid floor,
   orbit) shows the character at the same instant. The <video>'s clock
   is the stage clock, exactly as in the studio.
   ------------------------------------------------------------------ */

import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Stage, { type StageView } from "./Stage";
import { BACKDROPS, swatch } from "@/lib/backdrops";
import { LM_EDGES } from "@/lib/skeleton";
import { DEFAULT_GRID } from "@/lib/grid";
import { type Body, forwardKinematics } from "@/lib/fk";
import type { Pose } from "@/lib/pose";
import { type AzEl, type Vec3, fromAzEl, toAzEl, norm, angleDiff, lerp, cross, add, scale, DEG } from "@/lib/geometry";
import type { SourceInfo } from "@/lib/score";

interface HeroData {
  source: SourceInfo;
  body: Body;
  raw: Pose[];
  /** Per frame: [hip u across the picture, floor v down the picture, metres the picture spans]. */
  anchors: [number, number, number][];
  /** Per frame: the tracker's 2D landmarks, x, y, visibility × 33, in picture fractions; null where nobody was seen. */
  image?: (number[] | null)[];
}

interface Rect { x: number; y: number; w: number; h: number }

/** The slice of the frame shown, fractions across, for clips whose sides the dancer never uses. */
const CROP = { l: 0, r: 1 };
const SPAN = CROP.r - CROP.l;
/** Wide layouts wider than this also carry the cast picker (`children`) at the stage's right edge. */
const CAST_FROM = 720;
/** Pixels between the picture, the stage and the picker. */
const GUTTER = 6;
/** How much of the dancer's travel across the floor the character keeps (the stage camera is fixed). */
const TRAVEL = 0.4;
/** The figure is framed this much smaller than the dancer in the picture, so raised arms stay in the panel. */
const HEADROOM = 0.88;

const noop = () => {};

export default function HeroDuet({ avatarUrl, backdrop, onBackdrop, children }: { avatarUrl: string; backdrop: string; onBackdrop: (id: string) => void; children?: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const castRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<HeroData | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState(0);
  const [castWidth, setCastWidth] = useState(0);
  const [fi, setFi] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/demo/gal.json").then((r) => r.json()).then((d: HeroData) => { if (alive) setData({ ...d, raw: steady(d.raw, d.image) }); }).catch(() => { /* the video still plays */ });
    return () => { alive = false; };
  }, []);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => { setWidth(el.clientWidth); setHeight(el.clientHeight); setCastWidth(castRef.current?.offsetWidth ?? 0); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (castRef.current) ro.observe(castRef.current);
    return () => ro.disconnect();
  }, [width]);

  const aspect = (data ? data.source.width / data.source.height : 540 / 464) * SPAN;
  const wide = !!width && width >= CAST_FROM;
  // The box fills the space it is given; the picture and the stage split its width equally.
  // `box` is the picture's half, `rect` the whole picture covering it (it may overhang and be trimmed).
  const half = width ? (width - (wide ? castWidth + GUTTER : 0) - GUTTER) / 2 : 0;
  const box = half > 0 && height > 0 ? { w: half, h: height } : null;
  const rect: Rect | null = useMemo(() => {
    if (half <= 0 || height <= 0) return null;
    const w = Math.max(half, height * aspect), h = w / aspect;
    return { x: (half - w) / 2, y: (height - h) / 2, w, h };
  }, [half, height, aspect]);

  // The video clock drives everything: the frame index for the stage, and the landmarks over the picture.
  useEffect(() => {
    if (!data || !rect) return;
    const n = data.raw.length;
    let last = -1, raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v) return;
      // Fractional, so the character moves between tracked frames instead of stepping at 30 fps.
      const f = Math.max(0, Math.min(n - 1, v.currentTime * data.source.fps));
      if (f === last) return;
      last = f;
      setFi(f);
      const i = Math.floor(f), j = Math.min(n - 1, i + 1);
      drawLandmarks(overlayRef.current, blendLandmarks(data.image?.[i] ?? null, data.image?.[j] ?? null, f - i), rect);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data, rect]);

  // The dancer's average spot, so the character stays centred on the stage; the travel around it is
  // kept but shrunk, the hero's camera is fixed and a dancer who crosses the room would leave the frame.
  const centre = useMemo(() => {
    if (!data || !data.raw.length) return { x: 0, z: 0 };
    const n = data.raw.length;
    return { x: data.raw.reduce((a, p) => a + p.x, 0) / n, z: data.raw.reduce((a, p) => a + p.z, 0) / n };
  }, [data]);
  const pose = useMemo(() => {
    if (!data) return null;
    const i = Math.floor(fi), p = blendPose(data.raw[i], data.raw[Math.min(data.raw.length - 1, i + 1)], fi - i);
    return grounded({ ...p, x: (p.x - centre.x) * TRAVEL, z: (p.z - centre.z) * TRAVEL }, data.body);
  }, [data, fi, centre]);
  const stageLeft = box ? box.w + GUTTER : 0;

  // Frame the stage so the figure takes the same share of its panel, in the same spot, as the dancer in the picture.
  const extent = useMemo(() => (data?.image ? pictureExtent(data.image) : null), [data]);
  const view = useMemo(() => (data && extent && rect && box ? frameFigure(data.body, extent, rect, box) : undefined), [data, extent, rect, box?.w, box?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={boxRef} className="duet" aria-label="A dancer on video with the tracking drawn over them, and a character performing the same dance on the stage beside">
      {rect && (
        <div className="duet-picture" style={{ left: 0, top: 0, width: box!.w, height: box!.h }}>
          <video ref={videoRef} className="duet-video" src="/demo/gal.mp4" poster="/demo/gal.jpg" muted loop autoPlay playsInline preload="auto"
            style={{ left: rect.x - CROP.l * rect.w / SPAN, top: rect.y, width: rect.w / SPAN, height: rect.h }} />
          <canvas ref={overlayRef} className="duet-overlay" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
        </div>
      )}
      {rect && (
        <div className="duet-stage" style={{ left: stageLeft, width: box!.w }}>
          {pose && data && (
            <Stage pose={pose} raw={pose} body={data.body} grid={DEFAULT_GRID} motion="stepped" showRaw={false} avatar avatarUrl={avatarUrl} cast={[]} selected={null} onSelect={noop} backdrop={backdrop} view={view} shadow />
          )}
          <div className="duet-backdrops" role="group" aria-label="Backdrop">
            {BACKDROPS.map((b) => <button key={b.id} title={b.label} aria-label={b.label} aria-pressed={b.id === backdrop} style={{ background: swatch(b) }} onClick={() => onBackdrop(b.id)} />)}
          </div>
        </div>
      )}
      {width !== null && width >= CAST_FROM && children && <div ref={castRef} className="duet-cast">{children}</div>}
    </div>
  );
}

/** Over the clip, the median size and centre of the dancer in the picture: the longer side of the
 *  box around the clearly seen landmarks (as fractions of picture width / height), and its centre. */
function pictureExtent(image: (number[] | null)[]): { dx: number; dy: number; cx: number; cy: number } | null {
  const dx: number[] = [], dy: number[] = [], cx: number[] = [], cy: number[] = [];
  for (const lm of image) {
    if (!lm) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < lm.length; i += 3) {
      if (lm[i + 2] < 0.5) continue;
      x0 = Math.min(x0, lm[i]); x1 = Math.max(x1, lm[i]); y0 = Math.min(y0, lm[i + 1]); y1 = Math.max(y1, lm[i + 1]);
    }
    if (x1 < x0) continue;
    dx.push(x1 - x0); dy.push(y1 - y0); cx.push((x0 + x1) / 2); cy.push((y0 + y1) / 2);
  }
  if (!dx.length) return null;
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
  return { dx: med(dx), dy: med(dy), cx: med(cx), cy: med(cy) };
}

/** The camera that shows a standing figure of this body as tall, on its panel, as the dancer is long in the
 *  picture, and where the dancer sits in it. Same angle as the studio's camera, only nearer or farther and shifted. */
function frameFigure(body: Body, e: { dx: number; dy: number; cx: number; cy: number }, rect: Rect, box: { w: number; h: number }): StageView {
  const L = body.lengths;
  const height = L.torso + L.head + (L.lthigh + L.rthigh) / 2 + (L.lshin + L.rshin) / 2 + 0.06;
  // In panel fractions: the dancer's longer side against the panel height, and their centre.
  const share = Math.min(0.95, Math.max(0.2, Math.max(e.dx * rect.w, e.dy * rect.h) / box.h * HEADROOM));
  const u = (rect.x + e.cx * rect.w) / box.w, v = (rect.y + e.cy * rect.h) / box.h;
  const tan = Math.tan(22.5 * DEG);
  const dist = height / (share * 2 * tan);
  const visH = 2 * dist * tan, visW = visH * (box.w / box.h);
  const dir = norm({ x: 1.8, y: 0.5, z: 3.2 });
  const right = norm(cross({ x: 0, y: 1, z: 0 }, dir)), up = cross(dir, right);
  const target = add({ x: 0, y: height / 2, z: 0 }, add(scale(right, -(u - 0.5) * visW), scale(up, (v - 0.5) * visH)));
  const pos = add(target, scale(dir, dist));
  return { position: [pos.x, pos.y, pos.z], target: [target.x, target.y, target.z] };
}

/** The pose raised or lowered so its lowest point rests on the floor. The clip is filmed from above, so the
 *  tracker's hip height means nothing here; without this the figure hovers or sinks. */
function grounded(p: Pose, body: Body): Pose {
  const J = forwardKinematics(p, body);
  let low = Infinity;
  for (const k in J) low = Math.min(low, J[k as keyof typeof J].y);
  return Number.isFinite(low) ? { ...p, hipY: p.hipY - low } : p;
}

/** Median then Gaussian over a series: the median drops single-frame flips, the Gaussian the shiver. */
function filter(xs: number[], half = 4, sigma = 2.5): number[] {
  const n = xs.length;
  const med = xs.map((_, i) => {
    const w = xs.slice(Math.max(0, i - half), Math.min(n, i + half + 1)).sort((a, b) => a - b);
    return w[w.length >> 1];
  });
  const r = Math.ceil(sigma * 2.5);
  return med.map((_, i) => {
    let s = 0, ws = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      s += med[j] * w; ws += w;
    }
    return s / ws;
  });
}

/** Each bone's two ends as tracker landmarks (hand and foot tips by the index finger and toe, the head by the nose). */
const BONE_ENDS: Record<string, [number, number]> = {
  torso: [23, 11], shoulders: [11, 12], head: [11, 0],
  ruarm: [12, 14], rfarm: [14, 16], rhand: [16, 20], luarm: [11, 13], lfarm: [13, 15], lhand: [15, 19],
  rthigh: [24, 26], rshin: [26, 28], rfoot: [28, 32], lthigh: [23, 25], lshin: [25, 27], lfoot: [27, 31],
};
/** Below this visibility at either end a bone is lost for the frame, and its direction is not believed. */
const SEEN = 0.5;

/** Where a bone was lost, its direction glides between the nearest frames on either side where it was seen. */
function bridge(v: Vec3[], seen: boolean[]): Vec3[] {
  const good = seen.flatMap((s, i) => (s ? [i] : []));
  if (!good.length || good.length === v.length) return v;
  return v.map((d, i) => {
    if (seen[i]) return d;
    let a = -1, b = -1;
    for (const g of good) { if (g < i) a = g; else { b = g; break; } }
    if (a < 0) return v[b];
    if (b < 0) return v[a];
    const u = (i - a) / (b - a);
    return norm({ x: lerp(v[a].x, v[b].x, u), y: lerp(v[a].y, v[b].y, u), z: lerp(v[a].z, v[b].z, u) });
  });
}

/** The hero's track, steadied for display (the clip is filmed from above, a hard case for the tracker):
 *  lost limbs bridged from where they were seen, then each bone's direction filtered as a vector,
 *  facing unwrapped and filtered, the hips filtered. */
function steady(raw: Pose[], image?: (number[] | null)[]): Pose[] {
  if (raw.length < 3) return raw;
  const keys = Object.keys(raw[0].bones) as (keyof Pose["bones"])[];
  const bones = Object.fromEntries(keys.map((k) => {
    const ends = BONE_ENDS[k];
    const seen = raw.map((_, i) => { const lm = image?.[i]; return !ends || !lm || Math.min(lm[ends[0] * 3 + 2], lm[ends[1] * 3 + 2]) >= SEEN; });
    const v = bridge(raw.map((p) => fromAzEl(p.bones[k])), seen);
    const [x, y, z] = (["x", "y", "z"] as const).map((c) => filter(v.map((d) => d[c])));
    return [k, x.map((_, i) => toAzEl(norm({ x: x[i], y: y[i], z: z[i] })) as AzEl)];
  })) as Record<keyof Pose["bones"], AzEl[]>;
  const unwrapped = raw.reduce<number[]>((acc, p, i) => { acc.push(i ? acc[i - 1] + angleDiff(raw[i - 1].facing, p.facing) : p.facing); return acc; }, []);
  const facing = filter(unwrapped), x = filter(raw.map((p) => p.x)), z = filter(raw.map((p) => p.z)), hipY = filter(raw.map((p) => p.hipY));
  return raw.map((p, i) => ({ ...p, facing: facing[i], x: x[i], z: z[i], hipY: hipY[i], bones: Object.fromEntries(keys.map((k) => [k, bones[k][i]])) as Pose["bones"] }));
}

/** Between two tracked frames: positions and facing interpolated, each bone's direction along the sphere. */
function blendPose(a: Pose, b: Pose, u: number): Pose {
  if (u <= 0 || a === b) return a;
  const bones = {} as Pose["bones"];
  for (const k of Object.keys(a.bones) as (keyof Pose["bones"])[]) {
    const da = fromAzEl(a.bones[k]), db = fromAzEl(b.bones[k]);
    bones[k] = toAzEl(norm({ x: lerp(da.x, db.x, u), y: lerp(da.y, db.y, u), z: lerp(da.z, db.z, u) })) as AzEl;
  }
  return { ...a, t: lerp(a.t, b.t, u), facing: a.facing + angleDiff(a.facing, b.facing) * u, x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u), hipY: lerp(a.hipY, b.hipY, u), bones };
}

function blendLandmarks(a: number[] | null, b: number[] | null, u: number): number[] | null {
  if (!a || !b || u <= 0) return a ?? b;
  return a.map((x, k) => lerp(x, b[k], u));
}

/** The studio's overlay: landmark edges in the person's left (cyan) / right (magenta), joints in amber. */
function drawLandmarks(cv: HTMLCanvasElement | null, lm: number[] | null, rect: Rect) {
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(rect.w * dpr), h = Math.round(rect.h * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.w, rect.h);
  if (!lm) return;
  const P = (i: number) => [((lm[i * 3] - CROP.l) / SPAN) * rect.w, lm[i * 3 + 1] * rect.h, lm[i * 3 + 2]] as const;
  ctx.lineWidth = 2;
  for (const [a, b] of LM_EDGES) {
    const [ax, ay, av] = P(a), [bx, by, bv] = P(b);
    if (Math.min(av, bv) < 0.3) continue;
    const left = a % 2 === 1 && b % 2 === 1 && a > 0;
    const right = a % 2 === 0 && b % 2 === 0 && a > 0;
    ctx.strokeStyle = left ? "rgba(76,201,240,.9)" : right ? "rgba(247,37,133,.9)" : "rgba(232,233,236,.8)";
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  ctx.fillStyle = "#f0b429";
  for (let i = 0; i < 33; i++) {
    const [x, y, v] = P(i);
    if (v < 0.3) continue;
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
}
