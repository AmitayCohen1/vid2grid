"use client";

import type { GridConfig } from "@/lib/grid";
import type { LiftMode, SmoothConfig } from "@/lib/score";

interface Props {
  grid: GridConfig;
  smooth: SmoothConfig;
  onGrid: (g: GridConfig) => void;
  onSmooth: (s: SmoothConfig) => void;
  showRaw: boolean;
  onShowRaw: (b: boolean) => void;
  showOverlay: boolean;
  onShowOverlay: (b: boolean) => void;
  lift: LiftMode;
  onLift: (m: LiftMode) => void;
  canLift: boolean;
}

const AZ_STEPS = [11.25, 22.5, 45];
const EL_STEPS = [11.25, 22.5, 45];

/** The grid is a setting: change it and the whole score re-snaps instantly. */
export default function Controls({ grid, smooth, onGrid, onSmooth, showRaw, onShowRaw, showOverlay, onShowOverlay, lift, onLift, canLift }: Props) {
  return (
    <div className="text-xs flex flex-col gap-3 p-3">
      <Row label="3D from">
        <div className={canLift ? "" : "opacity-40 pointer-events-none"}>
          <Seg value={lift} options={["anchored", "world"] as LiftMode[]} fmt={(v) => (v === "anchored" ? "2D-anchored" : "MediaPipe 3D")} onChange={onLift} />
        </div>
      </Row>
      <Row label="azimuth step">
        <Seg value={grid.azStep} options={AZ_STEPS} fmt={(v) => `${v}°`} onChange={(v) => onGrid({ ...grid, azStep: v })} />
      </Row>
      <Row label="elevation step">
        <Seg value={grid.elStep} options={EL_STEPS} fmt={(v) => `${v}°`} onChange={(v) => onGrid({ ...grid, elStep: v })} />
      </Row>
      <Row label="facing step">
        <Seg value={grid.facingStep} options={[22.5, 45, 90]} fmt={(v) => `${v}°`} onChange={(v) => onGrid({ ...grid, facingStep: v })} />
      </Row>
      <Row label={`hysteresis ${grid.hysteresis.toFixed(2)}`}>
        <input type="range" min={0} max={0.5} step={0.05} value={grid.hysteresis} onChange={(e) => onGrid({ ...grid, hysteresis: +e.target.value })} className="w-full" />
      </Row>
      <Row label={`min dwell ${grid.minDwell} f`}>
        <input type="range" min={1} max={10} step={1} value={grid.minDwell} onChange={(e) => onGrid({ ...grid, minDwell: +e.target.value })} className="w-full" />
      </Row>
      <Row label={`smoothing ${smooth.minCutoff.toFixed(1)} Hz`}>
        <input type="range" min={0.3} max={5} step={0.1} value={smooth.minCutoff} onChange={(e) => onSmooth({ ...smooth, minCutoff: +e.target.value })} className="w-full" />
      </Row>
      <Row label={`responsiveness ${smooth.beta.toFixed(2)}`}>
        <input type="range" min={0} max={3} step={0.05} value={smooth.beta} onChange={(e) => onSmooth({ ...smooth, beta: +e.target.value })} className="w-full" />
      </Row>
      <div className="flex gap-4 pt-1">
        <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={showRaw} onChange={(e) => onShowRaw(e.target.checked)} /> raw ghost</label>
        <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={showOverlay} onChange={(e) => onShowOverlay(e.target.checked)} /> landmarks</label>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[7.5rem_1fr] items-center gap-2">
      <span className="text-muted mono">{label}</span>
      {children}
    </label>
  );
}

function Seg<T extends number | string>({ value, options, fmt, onChange }: { value: T; options: T[]; fmt: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded border border-line overflow-hidden">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-2 py-0.5 mono ${o === value ? "bg-accent text-black" : "hover:bg-panel-2"}`}
        >
          {fmt(o)}
        </button>
      ))}
    </div>
  );
}
