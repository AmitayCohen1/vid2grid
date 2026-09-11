"use client";

/* ------------------------------------------------------------------
   The landing hero: a real clip, its tracking, and a character dancing
   the score on the studio's own stage.

   `/demo/eden.json` is the app's own output for `/demo/eden.mp4`
   (poses, body, the tracker's 2D landmarks per frame — produced by
   scripts/hero-data.ts through lib/tracker → lib/score). The picture
   sits at the left with the landmarks drawn over it exactly as the
   studio's Side by side view does; beside it the studio Stage (grid floor,
   orbit) shows the character at the same instant. The <video>'s clock
   is the stage clock, exactly as in the studio.
   ------------------------------------------------------------------ */

import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Stage from "./Stage";
import { LM_EDGES } from "@/lib/skeleton";
import { DEFAULT_GRID } from "@/lib/grid";
import type { Body } from "@/lib/fk";
import type { Pose } from "@/lib/pose";
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

/** The picture is at most this share of the stage width (wide / narrow), and at most this tall. */
const PICTURE = 0.36, PICTURE_NARROW = 0.5;
const MAX_HEIGHT = 600;
/** The slice of the frame shown, fractions across, for clips whose sides the dancer never uses. */
const CROP = { l: 0, r: 1 };
const SPAN = CROP.r - CROP.l;
/** Wide layouts wider than this also carry the cast picker (`children`) at the stage's right edge. */
const CAST_FROM = 720;
/** Pixels between the picture, the stage and the picker. */
const GUTTER = 6;
/** How much of the dancer's travel across the floor the character keeps (the stage camera is fixed). */
const TRAVEL = 0.4;

const noop = () => {};

export default function HeroDuet({ avatarUrl, children }: { avatarUrl: string; children?: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const castRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<HeroData | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [castWidth, setCastWidth] = useState(0);
  const [fi, setFi] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/demo/eden.json").then((r) => r.json()).then((d: HeroData) => { if (alive) setData(d); }).catch(() => { /* the video still plays */ });
    return () => { alive = false; };
  }, []);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => { setWidth(el.clientWidth); setCastWidth(castRef.current?.offsetWidth ?? 0); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (castRef.current) ro.observe(castRef.current);
    return () => ro.disconnect();
  }, [width]);

  const aspect = (data ? data.source.width / data.source.height : 540 / 464) * SPAN;
  const wide = !!width && width >= CAST_FROM;
  const rect: Rect | null = useMemo(() => {
    if (!width) return null;
    const w = Math.min(width * (wide ? PICTURE : PICTURE_NARROW), MAX_HEIGHT * aspect);
    return { x: 0, y: 0, w, h: w / aspect };
  }, [width, wide, aspect]);

  // The video clock drives everything: the frame index for the stage, and the landmarks over the picture.
  useEffect(() => {
    if (!data || !rect) return;
    const n = data.raw.length;
    let last = -1, raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v) return;
      const i = Math.max(0, Math.min(n - 1, Math.round(v.currentTime * data.source.fps)));
      if (i === last) return;
      last = i;
      setFi(i);
      drawLandmarks(overlayRef.current, data.image?.[i] ?? null, rect);
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
  const pose = useMemo(() => (data ? { ...data.raw[fi], x: (data.raw[fi].x - centre.x) * TRAVEL, z: (data.raw[fi].z - centre.z) * TRAVEL } : null), [data, fi, centre]);
  const stageLeft = rect ? rect.w + GUTTER : 0;
  const stageRight = castWidth ? castWidth + GUTTER : 0;

  return (
    <div ref={boxRef} className="duet" style={{ height: rect?.h }} aria-label="A dancer on video with the tracking drawn over them, and a character performing the same dance on the stage beside">
      {rect && (
        <div className="duet-picture" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
          <video ref={videoRef} className="duet-video" src="/demo/eden.mp4" poster="/demo/eden.jpg" muted loop autoPlay playsInline preload="auto"
            style={{ left: -CROP.l * rect.w / SPAN, width: rect.w / SPAN, height: rect.h }} />
          <canvas ref={overlayRef} className="duet-overlay" />
        </div>
      )}
      {rect && (
        <div className="duet-stage" style={{ left: stageLeft, right: stageRight }}>
          {pose && data && (
            <Stage pose={pose} raw={pose} body={data.body} grid={DEFAULT_GRID} motion="stepped" showRaw={false} avatar avatarUrl={avatarUrl} cast={[]} selected={null} onSelect={noop} />
          )}
        </div>
      )}
      {width !== null && width >= CAST_FROM && children && <div ref={castRef} className="duet-cast">{children}</div>}
    </div>
  );
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
