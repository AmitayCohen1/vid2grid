"use client";

import { forwardRef, useEffect, useRef } from "react";
import { LM_EDGES } from "@/lib/skeleton";
import { type Crop, FULL_CROP } from "@/lib/crop";
import { Film } from "lucide-react";

interface Props {
  src: string | null;
  /** A live camera instead of a file; shown as-is (not mirrored) so the overlay and the stage agree on left and right. */
  stream?: MediaStream | null;
  /** The tracked region of the clip; the pane shows only this, and the overlay is in its coordinates. */
  crop?: Crop | null;
  overlay: Float32Array | null;
  showOverlay: boolean;
  onLoaded?: (v: HTMLVideoElement) => void;
  onError?: () => void;
}

/** The source video (or the tracked crop of it) with the tracker's 2D landmarks drawn over it. */
const VideoPane = forwardRef<HTMLVideoElement, Props>(function VideoPane({ src, stream, crop, overlay, showOverlay, onLoaded, onError }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<() => void>(() => {});

  // A stream can't be a `src` attribute; hand it to the element directly.
  useEffect(() => {
    const video = boxRef.current?.querySelector("video");
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
    return () => { if (video.srcObject === stream) video.srcObject = null; };
  }, [stream]);

  useEffect(() => {
    const cv = canvasRef.current;
    const box = boxRef.current;
    if (!cv || !box) return;
    const draw = () => {
    const w = box.clientWidth, h = box.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    const video = box.querySelector("video");
    if (!video || !video.videoWidth) return;
    // Letterbox the crop into the box, then size the video so exactly the crop lands there.
    const c = crop ?? FULL_CROP;
    const va = (c.w * video.videoWidth) / (c.h * video.videoHeight);
    const ba = w / h;
    let dw = w, dh = h, ox = 0, oy = 0;
    if (va > ba) { dh = w / va; oy = (h - dh) / 2; } else { dw = h * va; ox = (w - dw) / 2; }
    const vw = dw / c.w, vh = dh / c.h;
    Object.assign(video.style, { width: `${vw}px`, height: `${vh}px`, left: `${ox - c.x * vw}px`, top: `${oy - c.y * vh}px` });
    if (!showOverlay || !overlay) return;
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
    };
    drawRef.current = draw;
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [overlay, showOverlay, src, stream, crop]);

  return (
    <div ref={boxRef} className="relative w-full h-full bg-black overflow-hidden">
      {src || stream ? (
        <video
          key={src ?? "live"}
          ref={ref}
          src={src ?? undefined}
          className="absolute max-w-none w-full h-full"
          playsInline
          muted
          autoPlay={!!stream}
          preload="auto"
          onLoadedMetadata={(e) => { drawRef.current(); onLoaded?.(e.currentTarget); }}
          onError={onError}
        />
      ) : (
        <div className="video-placeholder"><Film size={23} strokeWidth={1.2} /><span>A dance without a camera.</span><small>This study has no source video.<br />Explore its movement on the stage.</small></div>
      )}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
    </div>
  );
});

export default VideoPane;
