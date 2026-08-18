"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Score } from "@/lib/score";
import { TRACE_JOINTS, alignments, movementDensity, pointsFromLandmarks, pointsFromPose, type Points2D } from "@/lib/objects";

export interface ObjectsOptions {
  traces: boolean;
  trailSeconds: number;
  alignments: boolean;
  density: boolean;
  video: boolean;
}

export const DEFAULT_OBJECTS: ObjectsOptions = { traces: true, trailSeconds: 1.5, alignments: true, density: true, video: true };

interface Props {
  score: Score;
  overlays: (Float32Array | null)[] | null;
  video: HTMLVideoElement | null;
  frame: number;
  options: ObjectsOptions;
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

/**
 * The annotated video: the current frame painted with traces of hands, feet
 * and head, lines through limbs that align, and a movement-density strip.
 */
export default function Objects({ score, overlays, video, frame, options }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const frames = useFrames2D(score, overlays);
  const aspect = score.source.width / score.source.height || 16 / 9;
  const density = useMemo(() => movementDensity(frames, aspect), [frames, aspect]);
  const fps = score.source.fps;

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
    ctx.fillStyle = "#050608";
    ctx.fillRect(0, 0, W, H);

    // Letterbox the source aspect into the box.
    let dw = W, dh = W / aspect;
    if (dh > H) { dh = H; dw = H * aspect; }
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    const X = (u: number) => ox + u * dw;
    const Y = (v: number) => oy + v * dh;

    if (options.video && video && video.readyState >= 2 && video.videoWidth) {
      ctx.drawImage(video, ox, oy, dw, dh);
      // Forsythe-style desaturated plate so the drawing reads.
      ctx.fillStyle = "rgba(5,6,8,0.35)";
      ctx.fillRect(ox, oy, dw, dh);
    } else {
      ctx.fillStyle = "#0b0c0f";
      ctx.fillRect(ox, oy, dw, dh);
    }

    const cur = frames[frame];

    // Traces
    if (options.traces) {
      const span = Math.max(1, Math.round(options.trailSeconds * fps));
      const from = Math.max(0, frame - span);
      for (const { id, color } of TRACE_JOINTS) {
        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        let prev: [number, number] | null = null;
        for (let i = from; i <= frame; i++) {
          const p = frames[i]?.[id];
          if (!p) { prev = null; continue; }
          if (prev) {
            const a = (i - from) / span;
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.15 + 0.85 * a * a;
            ctx.beginPath(); ctx.moveTo(X(prev[0]), Y(prev[1])); ctx.lineTo(X(p[0]), Y(p[1])); ctx.stroke();
          }
          prev = p;
        }
        ctx.globalAlpha = 1;
        const p = cur?.[id];
        if (p) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 3, 0, Math.PI * 2); ctx.fill(); }
      }
    }

    // Alignments
    if (options.alignments && cur) {
      const al = alignments(cur, aspect);
      for (const a of al) {
        const [p, q] = a.a, [r, s] = a.b;
        const extend = (u: [number, number], v: [number, number]) => {
          const dx = X(v[0]) - X(u[0]), dy = Y(v[1]) - Y(u[1]);
          const l = Math.hypot(dx, dy) || 1;
          const k = Math.max(W, H);
          return [[X(u[0]) - (dx / l) * k, Y(u[1]) - (dy / l) * k], [X(v[0]) + (dx / l) * k, Y(v[1]) + (dy / l) * k]] as const;
        };
        ctx.lineWidth = a.collinear ? 1.2 : 0.8;
        ctx.strokeStyle = a.collinear ? "rgba(240,180,41,0.9)" : "rgba(240,180,41,0.45)";
        ctx.setLineDash(a.collinear ? [] : [4, 4]);
        for (const [u, v] of [[p, q], [r, s]] as [[number, number], [number, number]][]) {
          const [e0, e1] = extend(u, v);
          ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.stroke();
        }
        ctx.setLineDash([]);
        // tie the two midpoints
        const m1 = [X((p[0] + q[0]) / 2), Y((p[1] + q[1]) / 2)], m2 = [X((r[0] + s[0]) / 2), Y((r[1] + s[1]) / 2)];
        ctx.strokeStyle = "rgba(240,180,41,0.9)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(m1[0], m1[1]); ctx.lineTo(m2[0], m2[1]); ctx.stroke();
      }
      if (al.length) {
        ctx.fillStyle = "rgba(240,180,41,0.95)";
        ctx.font = "11px ui-monospace, monospace";
        al.slice(0, 6).forEach((a, i) => ctx.fillText(`${a.collinear ? "═" : "∥"} ${a.labels[0]} · ${a.labels[1]}`, ox + 10, oy + 18 + i * 14));
      }
    }

    // Movement density strip
    if (options.density) {
      const h = 46, y0 = oy + dh - h - 8, x0 = ox + 8, w = dw - 16;
      ctx.fillStyle = "rgba(5,6,8,0.55)";
      ctx.fillRect(x0, y0, w, h);
      const n = density.length;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + h);
      for (let i = 0; i < n; i++) ctx.lineTo(x0 + (i / (n - 1)) * w, y0 + h - Math.min(1, density[i]) * (h - 4));
      ctx.lineTo(x0 + w, y0 + h);
      ctx.closePath();
      ctx.fillStyle = "rgba(232,233,236,0.25)";
      ctx.fill();
      ctx.strokeStyle = "rgba(232,233,236,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const x = x0 + (i / (n - 1)) * w, y = y0 + h - Math.min(1, density[i]) * (h - 4); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
      // keyframe ticks
      ctx.fillStyle = "rgba(240,180,41,0.7)";
      for (const k of score.keyframes) ctx.fillRect(x0 + (k / (n - 1)) * w, y0 + h - 3, 1, 3);
      // playhead
      ctx.fillStyle = "#e8e9ec";
      ctx.fillRect(x0 + (frame / (n - 1)) * w, y0, 1.5, h);
      ctx.fillStyle = "rgba(232,233,236,0.7)";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText("movement density", x0 + 6, y0 + 12);
    }
  }, [score, frames, density, frame, options, video, aspect, fps, tick]);

  return (
    <div ref={boxRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}

/** The generative drawing: every trace of the whole clip, drawn once, coloured by speed. */
export function Drawing({ score, overlays }: { score: Score; overlays: (Float32Array | null)[] | null }) {
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
    ctx.fillStyle = "#f4f1ea";
    ctx.fillRect(0, 0, W, H);
    let dw = W, dh = W / aspect;
    if (dh > H) { dh = H; dw = H * aspect; }
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    ctx.lineCap = "round";
    for (const { id, color } of TRACE_JOINTS) {
      let prev: [number, number] | null = null;
      for (let i = 0; i < frames.length; i++) {
        const p = frames[i]?.[id];
        if (!p) { prev = null; continue; }
        if (prev) {
          const sp = Math.hypot((p[0] - prev[0]) * aspect, p[1] - prev[1]);
          ctx.strokeStyle = id === "headTop" ? "#2b2b2b" : color;
          ctx.globalAlpha = 0.25 + Math.min(0.75, sp * 25);
          ctx.lineWidth = 0.6 + Math.min(2.5, sp * 60);
          ctx.beginPath(); ctx.moveTo(ox + prev[0] * dw, oy + prev[1] * dh); ctx.lineTo(ox + p[0] * dw, oy + p[1] * dh); ctx.stroke();
        }
        prev = p;
      }
    }
    ctx.globalAlpha = 1;
  }, [frames, aspect]);
  return <canvas ref={canvasRef} className="w-full h-full block" />;
}
