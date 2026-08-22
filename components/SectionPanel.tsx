"use client";

import { useMemo, useRef, useState } from "react";
import type { Score } from "@/lib/score";
import { type QuantizeOptions, makeSection, quantizeKeys } from "@/lib/sectionize";
import { putSection } from "@/lib/sectionsDb";
import type { TempoEstimate } from "@/lib/tempo";

export interface SectionCfg extends QuantizeOptions { preview: boolean }

interface Props {
  score: Score;
  cfg: SectionCfg;
  onCfg: (c: SectionCfg) => void;
  estimate: TempoEstimate | null;
  onSeek: (t: number) => void;
}

export default function SectionPanel({ score, cfg, onCfg, estimate, onSeek }: Props) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const taps = useRef<number[]>([]);

  const quantized = useMemo(() => quantizeKeys(score, cfg), [score, cfg]);
  const duration = score.source.duration;
  const beatSec = 60 / cfg.bpm;
  const maxStart = Math.max(0, Math.floor((duration - cfg.offsetSec) / beatSec) - cfg.lengthBeats);

  const set = (patch: Partial<SectionCfg>) => onCfg({ ...cfg, ...patch });

  const tap = () => {
    const now = performance.now() / 1000;
    taps.current = [...taps.current.filter((t) => now - t < 3), now];
    if (taps.current.length >= 2) {
      const iv = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      const bpm = Math.round((60 / (iv.reduce((a, b) => a + b, 0) / iv.length)) * 10) / 10;
      if (bpm >= 30 && bpm <= 200) set({ bpm });
    }
  };

  const save = async () => {
    try {
      const s = makeSection(score, cfg, name.trim() || `section ${new Date().toLocaleTimeString()}`);
      await putSection(s);
      setStatus(`saved “${s.name}” — ${s.keys.length} keys / ${s.beats} beats`);
    } catch (e) {
      setStatus(`could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const download = () => {
    try {
      const s = makeSection(score, cfg, name.trim() || "section");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(s)], { type: "application/json" }));
      a.download = `${s.name.replace(/\s+/g, "-")}.section.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setStatus(`could not download: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /* --- beat strip: beats, keyframe ticks, quantized keys, draggable window --- */
  const stripW = 260, stripH = 46;
  const px = (t: number) => (t / duration) * stripW;
  const winStartSec = cfg.offsetSec + cfg.startBeat * beatSec;
  const winEndSec = winStartSec + cfg.lengthBeats * beatSec;
  const drag = useRef<{ mode: "move" | "resize"; x0: number; start0: number; len0: number } | null>(null);

  const onStripPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * stripW;
    if (e.type === "pointerdown") {
      e.currentTarget.setPointerCapture(e.pointerId);
      const nearEnd = Math.abs(x - px(winEndSec)) < 7;
      drag.current = { mode: nearEnd ? "resize" : "move", x0: x, start0: cfg.startBeat, len0: cfg.lengthBeats };
    } else if (e.type === "pointermove" && drag.current) {
      const dBeats = ((x - drag.current.x0) / stripW) * (duration / beatSec);
      if (drag.current.mode === "move") {
        set({ startBeat: Math.max(0, Math.min(Math.max(0, maxStart), Math.round(drag.current.start0 + dBeats))) });
      } else {
        const maxLen = Math.max(1, Math.min(8, Math.floor((duration - cfg.offsetSec) / beatSec) - cfg.startBeat));
        set({ lengthBeats: Math.max(1, Math.min(maxLen, Math.round(drag.current.len0 + dBeats))) });
      }
    } else if (e.type === "pointerup") {
      drag.current = null;
      onSeek(winStartSec);
    }
  };

  const beats: number[] = [];
  for (let b = 0; cfg.offsetSec + b * beatSec <= duration; b++) beats.push(b);

  return (
    <div className="px-3 pb-3 text-xs flex flex-col gap-2 border-t border-line pt-2">
      <div className="text-muted">section — quantized to ¼ beats</div>
      {estimate && (
        <div className="text-[11px] text-muted">
          estimate: {estimate.bpm} bpm{estimate.confidence === 0 ? " (fallback — clip too short or still)" : ` · confidence ${Math.round(estimate.confidence * 100)}%`}
        </div>
      )}
      <label className="grid grid-cols-[7.5rem_1fr_3.2rem] items-center gap-2">
        <span className="text-muted mono">tempo</span>
        <input type="range" min={30} max={200} step={0.5} value={cfg.bpm} onChange={(e) => set({ bpm: +e.target.value })} />
        <input className="bg-panel-2 rounded px-1 py-0.5 mono" type="number" min={30} max={200} step={0.5} value={cfg.bpm} onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) set({ bpm: Math.max(30, Math.min(200, v)) }); }} aria-label="BPM" />
      </label>
      <div className="flex items-center gap-2">
        <button className="btn" onClick={tap}>tap tempo</button>
        <span className="text-muted mono">offset {cfg.offsetSec.toFixed(2)} s</span>
        <button className="btn" onClick={() => set({ offsetSec: Math.max(0, cfg.offsetSec - beatSec / 8) })}>−⅛</button>
        <button className="btn" onClick={() => set({ offsetSec: cfg.offsetSec + beatSec / 8 })}>+⅛</button>
      </div>
      <svg
        viewBox={`0 0 ${stripW} ${stripH}`} className="w-full h-14 rounded bg-panel-2 cursor-ew-resize touch-none"
        onPointerDown={onStripPointer} onPointerMove={onStripPointer} onPointerUp={onStripPointer}
      >
        {beats.map((b) => (
          <line key={b} x1={px(cfg.offsetSec + b * beatSec)} x2={px(cfg.offsetSec + b * beatSec)} y1={4} y2={stripH - 4}
            stroke="currentColor" strokeOpacity={b % 4 === 0 ? 0.7 : 0.25} strokeWidth={b % 4 === 0 ? 1.2 : 0.7} />
        ))}
        {score.keyframes.map((fi) => (
          <line key={fi} x1={px(score.frames[fi].t)} x2={px(score.frames[fi].t)} y1={stripH - 14} y2={stripH - 4} stroke="#f0b429" strokeWidth={1} />
        ))}
        <rect x={px(winStartSec)} y={2} width={Math.max(2, px(winEndSec) - px(winStartSec))} height={stripH - 4}
          fill="#f0b429" fillOpacity={0.15} stroke="#f0b429" strokeWidth={1} />
        {quantized.keys.map((k, i) => {
          const x = px(winStartSec + k.beat * beatSec);
          return <path key={i} d={`M${x},${10} l4,6 l-4,6 l-4,-6 Z`} fill="#f0b429" />;
        })}
      </svg>
      <div className="flex items-center gap-2">
        <span className="text-muted mono">start beat {cfg.startBeat} · length {cfg.lengthBeats} · {quantized.keys.length} keys</span>
        <label className="ml-auto flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={cfg.preview} onChange={(e) => set({ preview: e.target.checked })} /> preview quantized
        </label>
      </div>
      <div className="flex items-center gap-2">
        <input className="bg-panel-2 rounded px-2 py-1 flex-1" placeholder="section name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Section name" />
        <button className="btn" onClick={save}>save to library</button>
        <button className="btn" onClick={download}>JSON</button>
      </div>
      {status && <div className="text-[11px] text-muted">{status}</div>}
      <div className="text-[11px] text-muted">
        sections open in the <a className="underline" href="/movement-languages/danceforms.html">studio</a> library
      </div>
    </div>
  );
}
