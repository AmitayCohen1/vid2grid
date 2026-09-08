"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Score } from "@/lib/score";
import { cropPixels } from "@/lib/crop";
import { alignments, movementDensity, pointsFromLandmarks, pointsFromPose, type Points2D } from "@/lib/objects";
import { GROUND, paintTraces, type TraceGround, type TraceStyle } from "@/lib/traces";

export interface ObjectsOptions {
  traces: boolean;
  trailSeconds: number;
  /** The trail runs from the start of the clip instead of `trailSeconds` back. */
  whole: boolean;
  alignments: boolean;
  density: boolean;
  video: boolean;
}

export const DEFAULT_OBJECTS: ObjectsOptions = { traces: true, trailSeconds: 1.5, whole: false, alignments: true, density: true, video: true };

interface Props {
  score: Score;
  overlays: (Float32Array | null)[] | null;
  video: HTMLVideoElement | null;
  frame: number;
  options: ObjectsOptions;
  style: TraceStyle;
}

export interface ObjectsHandle {
  /** The plate as it is now, painted at the source's pixel size (at least 2×) into a PNG. */
  toPng(): Promise<Blob | null>;
}

/** Per-frame 2D points for the whole clip (memoised). */
export function useFrames2D(score: Score, overlays: (Float32Array | null)[] | null) {
  return useMemo<(Points2D | null)[]>(() => {
    const aspect = score.source.width / score.source.height || 16 / 9;
    return score.raw.map((p, i) => {
      const buf = overlays?.[i];
      return buf ? pointsFromLandmarks(buf) : pointsFromPose(p, score.body, aspect);
    });
  }, [score, overlays]);
}

interface Plate {
  score: Score;
  frames: (Points2D | null)[];
  density: Float32Array;
  frame: number;
  options: ObjectsOptions;
  style: TraceStyle;
  video: HTMLVideoElement | null;
  aspect: number;
}

/** Paint the whole plate — picture, traces, alignments, density — into a W×H canvas. */
function paintPlate(ctx: CanvasRenderingContext2D, W: number, H: number, p: Plate) {
  const { score, frames, density, frame, options, style, video, aspect } = p;
  const fps = score.source.fps;
  const showVideo = options.video && !!video && video.readyState >= 2 && video.videoWidth > 0;
  const ground: TraceGround = showVideo ? "night" : style.ground;
  ctx.fillStyle = ground === "paper" ? "#e9e5da" : "#050608";
  ctx.fillRect(0, 0, W, H);

  // Letterbox the source aspect into the box.
  let dw = W, dh = W / aspect;
  if (dh > H) { dh = H; dw = H * aspect; }
  const ox = (W - dw) / 2, oy = (H - dh) / 2;
  const X = (u: number) => ox + u * dw;
  const Y = (v: number) => oy + v * dh;
  const scale = dh / 800;
  const ink = ground === "paper" ? "20,22,27" : "232,233,236";

  if (showVideo) {
    const c = score.source.crop;
    if (c) { const px = cropPixels(c, video.videoWidth, video.videoHeight); ctx.drawImage(video, px.x, px.y, px.w, px.h, ox, oy, dw, dh); }
    else ctx.drawImage(video, ox, oy, dw, dh);
    // Forsythe-style desaturated plate so the drawing reads.
    ctx.fillStyle = `rgba(5,6,8,${style.dim})`;
    ctx.fillRect(ox, oy, dw, dh);
  } else {
    ctx.fillStyle = GROUND[ground];
    ctx.fillRect(ox, oy, dw, dh);
  }

  const cur = frames[frame];

  if (options.traces) {
    const span = Math.max(1, Math.round(options.trailSeconds * fps));
    const from = options.whole ? 0 : Math.max(0, frame - span);
    paintTraces(ctx, { frames, from, to: frame, aspect, style, map: { X, Y, scale }, ground });
  }

  if (options.alignments && cur) {
    const al = alignments(cur, aspect);
    const gold = ground === "paper" ? "196,120,10" : "240,180,41";
    for (const a of al) {
      const [p, q] = a.a, [r, s] = a.b;
      const extend = (u: [number, number], v: [number, number]) => {
        const dx = X(v[0]) - X(u[0]), dy = Y(v[1]) - Y(u[1]);
        const l = Math.hypot(dx, dy) || 1;
        const k = Math.max(W, H);
        return [[X(u[0]) - (dx / l) * k, Y(u[1]) - (dy / l) * k], [X(v[0]) + (dx / l) * k, Y(v[1]) + (dy / l) * k]] as const;
      };
      ctx.lineWidth = (a.collinear ? 1.2 : 0.8) * Math.max(1, scale);
      ctx.strokeStyle = a.collinear ? `rgba(${gold},0.9)` : `rgba(${gold},0.45)`;
      ctx.setLineDash(a.collinear ? [] : [4 * scale, 4 * scale]);
      for (const [u, v] of [[p, q], [r, s]] as [[number, number], [number, number]][]) {
        const [e0, e1] = extend(u, v);
        ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.stroke();
      }
      ctx.setLineDash([]);
      // tie the two midpoints
      const m1 = [X((p[0] + q[0]) / 2), Y((p[1] + q[1]) / 2)], m2 = [X((r[0] + s[0]) / 2), Y((r[1] + s[1]) / 2)];
      ctx.strokeStyle = `rgba(${gold},0.9)`;
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath(); ctx.moveTo(m1[0], m1[1]); ctx.lineTo(m2[0], m2[1]); ctx.stroke();
    }
    if (al.length) {
      ctx.fillStyle = `rgba(${gold},0.95)`;
      const fs = Math.max(11, 11 * scale);
      ctx.font = `${fs}px ui-monospace, monospace`;
      al.slice(0, 6).forEach((a, i) => ctx.fillText(`${a.collinear ? "═" : "∥"} ${a.labels[0]} · ${a.labels[1]}`, ox + 10 * scale, oy + (18 + i * 14) * Math.max(1, scale)));
    }
  }

  if (options.density) {
    const k = Math.max(1, scale);
    const h = 46 * k, y0 = oy + dh - h - 8 * k, x0 = ox + 8 * k, w = dw - 16 * k;
    ctx.fillStyle = ground === "paper" ? "rgba(244,241,234,0.7)" : "rgba(5,6,8,0.55)";
    ctx.fillRect(x0, y0, w, h);
    const n = density.length;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + h);
    for (let i = 0; i < n; i++) ctx.lineTo(x0 + (i / (n - 1)) * w, y0 + h - Math.min(1, density[i]) * (h - 4 * k));
    ctx.lineTo(x0 + w, y0 + h);
    ctx.closePath();
    ctx.fillStyle = `rgba(${ink},0.25)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${ink},0.8)`;
    ctx.lineWidth = k;
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = x0 + (i / (n - 1)) * w, y = y0 + h - Math.min(1, density[i]) * (h - 4 * k); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    // keyframe ticks
    ctx.fillStyle = "rgba(240,180,41,0.7)";
    for (const kf of score.keyframes) ctx.fillRect(x0 + (kf / (n - 1)) * w, y0 + h - 3 * k, k, 3 * k);
    // playhead
    ctx.fillStyle = `rgb(${ink})`;
    ctx.fillRect(x0 + (frame / (n - 1)) * w, y0, 1.5 * k, h);
    ctx.fillStyle = `rgba(${ink},0.7)`;
    ctx.font = `${10 * k}px ui-monospace, monospace`;
    ctx.fillText("movement density", x0 + 6 * k, y0 + 12 * k);
  }
}

/**
 * The annotated video: the current frame painted with traces of hands, feet
 * and head, lines through limbs that align, and a movement-density strip.
 */
const Objects = forwardRef<ObjectsHandle, Props>(function Objects({ score, overlays, video, frame, options, style }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const frames = useFrames2D(score, overlays);
  const aspect = score.source.width / score.source.height || 16 / 9;
  const density = useMemo(() => movementDensity(frames, aspect), [frames, aspect]);
  const plate = useMemo<Plate>(() => ({ score, frames, density, frame, options, style, video, aspect }), [score, frames, density, frame, options, style, video, aspect]);
  const plateRef = useRef(plate);

  // Repaint when the video finishes seeking, so scrubbing shows the right frame.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!video) return;
    const on = () => setTick((t) => t + 1);
    video.addEventListener("seeked", on);
    return () => video.removeEventListener("seeked", on);
  }, [video]);

  useEffect(() => {
    void tick;
    const cv = canvasRef.current, box = boxRef.current;
    if (!cv || !box) return;
    const W = box.clientWidth, H = box.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintPlate(ctx, W, H, plate);
    plateRef.current = plate;
  }, [plate, tick]);

  useImperativeHandle(ref, () => ({
    toPng() {
      const p = plateRef.current;
      const sw = p.score.source.width || 1280, sh = p.score.source.height || 720;
      const k = Math.max(1, Math.min(4, 2400 / Math.max(sw, sh)));
      const W = Math.round(sw * k), H = Math.round(sh * k);
      const cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      paintPlate(cv.getContext("2d")!, W, H, p);
      return new Promise<Blob | null>((resolve) => cv.toBlob(resolve, "image/png"));
    },
  }), []);

  return (
    <div ref={boxRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
});

export default Objects;

/** The generative drawing: every trace of the whole clip, drawn once, in the current style. */
export function Drawing({ score, overlays, style }: { score: Score; overlays: (Float32Array | null)[] | null; style: TraceStyle }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frames = useFrames2D(score, overlays);
  const aspect = score.source.width / score.source.height || 16 / 9;
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const W = cv.clientWidth, H = cv.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = GROUND[style.ground];
    ctx.fillRect(0, 0, W, H);
    let dw = W, dh = W / aspect;
    if (dh > H) { dh = H; dw = H * aspect; }
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    // The thumbnail is small: everything at once, no fade, no glow, no position dots.
    const whole: TraceStyle = { ...style, fade: 0, glow: 0, dots: false, weight: Math.max(0.5, style.weight * 0.9) };
    paintTraces(ctx, { frames, from: 0, to: frames.length - 1, aspect, style: whole, map: { X: (u) => ox + u * dw, Y: (v) => oy + v * dh, scale: Math.max(0.5, dh / 800) }, ground: style.ground });
  }, [frames, aspect, style]);
  return <canvas ref={canvasRef} className="w-full h-full block" />;
}
