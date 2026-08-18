"use client";

import { forwardRef, useEffect, useRef } from "react";
import { LM_EDGES } from "@/lib/skeleton";

interface Props {
  src: string | null;
  overlay: Float32Array | null;
  showOverlay: boolean;
  onLoaded?: (v: HTMLVideoElement) => void;
}

/** The source video with the tracker's 2D landmarks drawn over it. */
const VideoPane = forwardRef<HTMLVideoElement, Props>(function VideoPane({ src, overlay, showOverlay, onLoaded }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const box = boxRef.current;
    if (!cv || !box) return;
    const w = box.clientWidth, h = box.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    if (!showOverlay || !overlay) return;
    const video = box.querySelector("video");
    if (!video || !video.videoWidth) return;
    // object-contain letterboxing
    const va = video.videoWidth / video.videoHeight;
    const ba = w / h;
    let dw = w, dh = h, ox = 0, oy = 0;
    if (va > ba) { dh = w / va; oy = (h - dh) / 2; } else { dw = h * va; ox = (w - dw) / 2; }
    const P = (i: number) => [ox + overlay[i * 3] * dw, oy + overlay[i * 3 + 1] * dh, overlay[i * 3 + 2]] as const;
    ctx.lineWidth = 2;
    for (const [a, b] of LM_EDGES) {
      const [ax, ay, av] = P(a), [bx, by, bv] = P(b);
      const vis = Math.min(av, bv);
      if (vis < 0.3) continue;
      // Person's left = cyan, right = magenta (matches the 3D figure).
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
  }, [overlay, showOverlay]);

  return (
    <div ref={boxRef} className="relative w-full h-full bg-black">
      {src ? (
        <video
          ref={ref}
          src={src}
          className="w-full h-full object-contain"
          playsInline
          muted
          preload="auto"
          onLoadedMetadata={(e) => onLoaded?.(e.currentTarget)}
        />
      ) : (
        <div className="w-full h-full grid place-items-center text-muted text-sm">no video</div>
      )}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
    </div>
  );
});

export default VideoPane;
