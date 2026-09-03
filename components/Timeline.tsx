"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pause, Play } from "lucide-react";
import type { Score } from "@/lib/score";
import { BONES, type BoneId } from "@/lib/skeleton";

interface Props {
  score: Score;
  /** The stage clock's full length — ≥ the score's duration when cast
   *  members outlast the current clip. */
  total: number;
  time: number;
  playing: boolean;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onStep: (frames: number) => void;
  selected: BoneId | null;
  onSelect: (id: BoneId | null) => void;
}

/** Colour for a grid cell: hue from azimuth, lightness from elevation. */
function cellColor(az: number, el: number): string {
  const l = 30 + ((el + 90) / 180) * 45;
  return `hsl(${Math.round(az)} 70% ${Math.round(l)}%)`;
}

const ROLL_LS_KEY = "vid2grid:roll-open";

export default function Timeline({ score, total, time, playing, onSeek, onTogglePlay, onStep, selected, onSelect }: Props) {
  const rollRef = useRef<HTMLCanvasElement>(null);
  const duration = score.source.duration;
  const stageTotal = Math.max(total, duration);
  const frac = duration / stageTotal; // the current score's share of the stage clock
  const rows = useMemo(() => BONES.filter((b) => b.core), []);
  const [rollOpen, setRollOpen] = useState(() => {
    try { return localStorage.getItem(ROLL_LS_KEY) !== "0"; } catch { return true; }
  });
  const toggleRoll = () => {
    setRollOpen((o) => {
      try { localStorage.setItem(ROLL_LS_KEY, o ? "0" : "1"); } catch { /* quota */ }
      return !o;
    });
  };

  // The grid roll: one row per core segment, colour = its cell over time.
  useEffect(() => {
    const cv = rollRef.current;
    if (!cv || !rollOpen) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const rowH = h / rows.length;
    const n = score.frames.length;
    const px = w / n;
    for (let r = 0; r < rows.length; r++) {
      const id = rows[r].id;
      let start = 0;
      let prev = score.frames[0].bones[id];
      for (let i = 1; i <= n; i++) {
        const cur = i < n ? score.frames[i].bones[id] : null;
        if (!cur || cur[0] !== prev[0] || cur[1] !== prev[1]) {
          ctx.fillStyle = cellColor(prev[0], prev[1]);
          ctx.fillRect(start * px, r * rowH + 1, (i - start) * px, rowH - 2);
          if (cur) { start = i; prev = cur; }
        }
      }
      if (selected === id) {
        ctx.strokeStyle = "#f0b429"; ctx.lineWidth = 1.5;
        ctx.strokeRect(0.75, r * rowH + 0.75, w - 1.5, rowH - 1.5);
      }
    }
    // low-confidence shading
    ctx.fillStyle = "rgba(0,0,0,.55)";
    for (let i = 0; i < n; i++) if (score.raw[i].conf < 0.4) ctx.fillRect(i * px, 0, px, h);
  }, [score, rows, selected, rollOpen]);

  const seekFromEvent = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onSeek(u * stageTotal);
  };

  return (
    <div className="flex flex-col gap-1.5 select-none">
      <div className="flex items-center gap-2 text-xs">
        <button className="btn px-2" onClick={() => onStep(-1)} title="previous frame (←)"><ChevronLeft size={14} /></button>
        <button className="btn primary w-20 justify-center" onClick={onTogglePlay} title="space">{playing ? <Pause size={13} /> : <Play size={13} />}{playing ? "pause" : "play"}</button>
        <button className="btn px-2" onClick={() => onStep(1)} title="next frame (→)"><ChevronRight size={14} /></button>
        <span className="mono text-muted-foreground ml-2">
          {time.toFixed(2)}s / {stageTotal.toFixed(2)}s · frame {Math.round(time * score.source.fps)} · {score.keyframes.length} keyframes
        </span>
        <button className="btn px-2 ml-auto" onClick={toggleRoll} title={rollOpen ? "hide the grid roll" : "show the grid roll"}>
          {rollOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      <div className="flex gap-2">
        <div className="w-10 shrink-0" />
        <div
          className="relative flex-1 h-4 rounded-full bg-muted border cursor-pointer overflow-hidden"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromEvent(e); }}
          onPointerMove={(e) => { if (e.buttons & 1) seekFromEvent(e); }}
        >
          {score.keyframes.map((k) => (
            <div key={k} className="absolute top-0 bottom-0 w-px bg-brand/60" style={{ left: `${(k / score.frames.length) * frac * 100}%` }} />
          ))}
          <div className="absolute top-0 bottom-0 w-0.5 bg-foreground" style={{ left: `${(time / stageTotal) * 100}%` }} />
        </div>
      </div>
      {rollOpen && (
      <div className="flex gap-2">
        <div className="w-10 shrink-0 flex flex-col text-[10px] leading-none text-muted-foreground mono">
          {rows.map((b) => (
            <button
              key={b.id}
              className={`flex-1 text-left hover:text-foreground ${selected === b.id ? "text-brand font-semibold" : ""}`}
              onClick={() => onSelect(selected === b.id ? null : b.id)}
            >
              {b.short}
            </button>
          ))}
        </div>
        <div
          className="relative flex-1 h-40 cursor-pointer"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromEvent(e); }}
          onPointerMove={(e) => { if (e.buttons & 1) seekFromEvent(e); }}
        >
          <div className="absolute inset-y-0 left-0" style={{ width: `${frac * 100}%` }}>
            <canvas ref={rollRef} className="absolute inset-0 w-full h-full rounded-md" />
          </div>
          <div className="absolute top-0 bottom-0 w-0.5 bg-foreground pointer-events-none" style={{ left: `${(time / stageTotal) * 100}%` }} />
        </div>
      </div>
      )}
    </div>
  );
}
