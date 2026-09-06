"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Music4, Pause, Play, Repeat2 } from "lucide-react";
import type { Score } from "@/lib/score";
import type { TempoEstimate } from "@/lib/tempo";
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
  speed: number;
  onSpeed: (speed: number) => void;
  loop: boolean;
  onLoop: () => void;
  /** Motion-derived pulse, or null before a score exists. */
  tempo: TempoEstimate | null;
  /** The tempo actually in force — the estimate unless the user overrode it. */
  bpm: number;
  onBpm: (bpm: number) => void;
}

/** Colour for a grid cell: hue from azimuth, lightness from elevation. */
function cellColor(az: number, el: number): string {
  const l = 30 + ((el + 90) / 180) * 45;
  return `hsl(${Math.round(az)} 70% ${Math.round(l)}%)`;
}

const ROLL_LS_KEY = "vid2grid:roll-open";
const BEATS_LS_KEY = "vid2grid:beats-on";
const BPM_MIN = 30, BPM_MAX = 200;
/** Beats per bar for the heavier bar line. */
const BAR = 4;
const clampBpm = (n: number) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(n * 10) / 10));

export default function Timeline({ score, total, time, playing, onSeek, onTogglePlay, onStep, selected, onSelect, speed, onSpeed, loop, onLoop, tempo, bpm, onBpm }: Props) {
  const rollRef = useRef<HTMLCanvasElement>(null);
  const beatRef = useRef<HTMLCanvasElement>(null);
  const duration = score.source.duration;
  const stageTotal = Math.max(total, duration);
  const frac = duration / stageTotal; // the current score's share of the stage clock
  const rows = useMemo(() => BONES.filter((b) => b.core), []);
  const [rollOpen, setRollOpen] = useState(() => {
    try { return localStorage.getItem(ROLL_LS_KEY) === "1"; } catch { return false; }
  });
  const [beatsOn, setBeatsOn] = useState(() => {
    try { return localStorage.getItem(BEATS_LS_KEY) === "1"; } catch { return false; }
  });
  const toggleBeats = () => {
    setBeatsOn((o) => {
      try { localStorage.setItem(BEATS_LS_KEY, o ? "0" : "1"); } catch { /* quota */ }
      return !o;
    });
  };
  /** Whether the clip actually has a pulse, as opposed to the 100 bpm default. */
  const detected = !!tempo && tempo.confidence >= 0.25;
  /** Beat times across the whole stage clock. offsetSec is the phase of the first beat. */
  const beatTimes = useMemo(() => {
    const period = 60 / bpm;
    if (!(period > 0.05)) return [];
    const out: number[] = [];
    for (let t = tempo ? tempo.offsetSec % period : 0; t <= stageTotal; t += period) out.push(t);
    return out;
  }, [bpm, tempo, stageTotal]);
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
    const draw = () => {
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
    // the pulse, over the top of the cells
    if (beatsOn) {
      beatTimes.forEach((t, b) => {
        ctx.fillStyle = b % BAR === 0 ? "rgba(255,255,255,.5)" : "rgba(255,255,255,.2)";
        ctx.fillRect(Math.round((t / stageTotal) * w), 0, 1, h);
      });
    }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(cv);
    return () => observer.disconnect();
  }, [score, rows, selected, rollOpen, total, beatsOn, beatTimes, stageTotal]);

  // The beat ruler: ticks across the stage clock, heavier every BAR beats.
  useEffect(() => {
    const cv = beatRef.current;
    if (!cv || !beatsOn) return;
    const draw = () => {
      const w = cv.clientWidth, h = cv.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = getComputedStyle(cv).color;   // inherits the theme's ink
      beatTimes.forEach((t, b) => {
        const bar = b % BAR === 0;
        ctx.globalAlpha = bar ? 0.75 : 0.28;
        ctx.fillRect(Math.round((t / stageTotal) * w), bar ? 0 : h * 0.45, 1, bar ? h : h * 0.55);
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(cv);
    return () => observer.disconnect();
  }, [beatsOn, beatTimes, stageTotal]);

  const seekFromEvent = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onSeek(u * stageTotal);
  };

  return (
    <div className="flex flex-col gap-1.5 select-none">
      <div className="transport flex items-center gap-2 text-xs">
        <button className="btn step-button" onClick={() => onStep(-1)} aria-label="Previous frame" title="Previous frame (←)"><ChevronLeft size={20} /></button>
        <button className="btn primary play-button" onClick={onTogglePlay} title="Play / pause (Space)">{playing ? <Pause size={18} /> : <Play size={18} />}{playing ? "Pause" : "Play"}</button>
        <button className="btn step-button" onClick={() => onStep(1)} aria-label="Next frame" title="Next frame (→)"><ChevronRight size={20} /></button>
        <button className={`btn loop-button ${loop ? "text-brand" : ""}`} onClick={onLoop} aria-label="Loop playback" aria-pressed={loop} title="Loop playback"><Repeat2 size={18} /><span>Loop</span></button>
        <button className={`btn loop-button ${beatsOn ? "text-brand" : ""}`} onClick={toggleBeats} aria-label="Show the beat" aria-pressed={beatsOn} title={tempo && tempo.confidence >= 0.25 ? `Show the beat (about ${Math.round(tempo.bpm)} BPM)` : "Show the beat — no clear pulse found, set it yourself"}><Music4 size={18} /><span>Beats</span></button>
        <select aria-label="Playback speed" className="speed-select mono" value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>{[0.25, 0.5, 0.75, 1, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
        <span className="transport-time mono text-muted-foreground ml-2">
          <span className="text-foreground">{time.toFixed(2)}</span> / {stageTotal.toFixed(2)} s <span className="transport-detail">· {score.keyframes.length} keyframes</span>
        </span>
        <button className="btn timeline-toggle" onClick={toggleRoll} aria-expanded={rollOpen} title={rollOpen ? "Hide notation timeline" : "Show notation timeline"}>
          <span>Timeline</span>
          {rollOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      <input className="playhead-range" type="range" aria-label="Playhead" aria-valuetext={`${time.toFixed(2)} seconds`} min={0} max={stageTotal} step={1 / score.source.fps} value={time} onChange={(e) => onSeek(Number(e.target.value))} />
      {beatsOn && (
      <div className="beat-strip">
        <canvas ref={beatRef} aria-hidden="true" />
        <div className="beat-controls mono">
          <button onClick={() => onBpm(clampBpm(bpm / 2))} disabled={bpm / 2 < BPM_MIN} title="Half tempo">÷2</button>
          <input type="number" aria-label="Beats per minute" min={BPM_MIN} max={BPM_MAX} step={0.5} value={Math.round(bpm * 10) / 10}
            data-guess={detected ? undefined : ""} title={detected ? "Detected from the movement — edit to override" : "No pulse detected in this clip — set the tempo yourself"}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onBpm(clampBpm(n)); }} />
          <span>{detected ? "BPM" : "BPM · set it"}</span>
          <button onClick={() => onBpm(clampBpm(bpm * 2))} disabled={bpm * 2 > BPM_MAX} title="Double tempo">×2</button>
        </div>
      </div>
      )}
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
          className="relative flex-1 h-40 cursor-pointer touch-none"
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
