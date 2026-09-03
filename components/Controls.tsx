"use client";

import { PersonStanding } from "lucide-react";
import { AVATAR_PRESETS } from "./Avatar";
import type { GridConfig } from "@/lib/grid";
import type { LiftMode, SmoothConfig } from "@/lib/score";

interface Props {
  grid: GridConfig;
  smooth: SmoothConfig;
  onGrid: (g: GridConfig) => void;
  onSmooth: (s: SmoothConfig) => void;
  showRaw: boolean;
  onShowRaw: (b: boolean) => void;
  avatar: boolean;
  onAvatar: (b: boolean) => void;
  avatarUrl: string;
  avatarName: string | null;
  onAvatarFile: (f: File) => void;
  onAvatarPreset: (url: string) => void;
  showOverlay: boolean;
  onShowOverlay: (b: boolean) => void;
  lift: LiftMode;
  onLift: (m: LiftMode) => void;
  canLift: boolean;
}

const AZ_STEPS = [11.25, 22.5, 45];
const EL_STEPS = [11.25, 22.5, 45];

/** The grid is a setting: change it and the whole score re-snaps instantly. */
export default function Controls({ grid, smooth, onGrid, onSmooth, showRaw, onShowRaw, avatar, onAvatar, avatarUrl, avatarName, onAvatarFile, onAvatarPreset, showOverlay, onShowOverlay, lift, onLift, canLift }: Props) {
  return (
    <div className="text-[13px] flex flex-col gap-5 p-4">
      <section className="flex flex-col gap-2.5">
        <div className="label">dancer</div>
        <Seg
          value={avatar ? "character" : "lines"}
          options={["lines", "character"]}
          fmt={(v) => (v === "lines" ? "stick figure" : "character")}
          onChange={(v) => onAvatar(v === "character")}
        />
        {avatar && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {AVATAR_PRESETS.map((p) => {
                const active = !avatarName && avatarUrl === p.url;
                return (
                  <button
                    key={p.url}
                    onClick={() => onAvatarPreset(p.url)}
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}
                  >
                    {p.label}
                  </button>
                );
              })}
              {avatarName && (
                <span className="rounded-md border border-primary bg-primary text-primary-foreground px-2 py-1 text-xs truncate max-w-40">{avatarName}</span>
              )}
              <label className="btn cursor-pointer h-7 px-2 text-xs">
                <PersonStanding size={13} /> load .vrm
                <input
                  type="file"
                  accept=".vrm,model/vrm"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onAvatarFile(f); e.currentTarget.value = ""; }}
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Any VRM avatar works: design a face, outfit and shoes in{" "}
              <a className="underline underline-offset-2 hover:text-foreground" href="https://vroid.com/en/studio" target="_blank" rel="noreferrer">VRoid Studio</a>{" "}
              (free) or pick one on{" "}
              <a className="underline underline-offset-2 hover:text-foreground" href="https://hub.vroid.com/en" target="_blank" rel="noreferrer">VRoid Hub</a>,
              then load the .vrm here. It never leaves your device.
            </p>
          </div>
        )}
        <div className="flex gap-4 pt-0.5">
          <Check label="raw ghost" checked={showRaw} onChange={onShowRaw} />
          <Check label="landmarks" checked={showOverlay} onChange={onShowOverlay} />
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="label">the grid</div>
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
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="label">smoothing</div>
        <Row label={`cutoff ${smooth.minCutoff.toFixed(1)} Hz`}>
          <input type="range" min={0.3} max={5} step={0.1} value={smooth.minCutoff} onChange={(e) => onSmooth({ ...smooth, minCutoff: +e.target.value })} className="w-full" />
        </Row>
        <Row label={`responsiveness ${smooth.beta.toFixed(2)}`}>
          <input type="range" min={0} max={3} step={0.05} value={smooth.beta} onChange={(e) => onSmooth({ ...smooth, beta: +e.target.value })} className="w-full" />
        </Row>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[7.5rem_1fr] items-center gap-2">
      <span className="text-muted-foreground mono text-xs">{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

function Seg<T extends number | string>({ value, options, fmt, onChange }: { value: T; options: T[]; fmt: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div className="seg self-start">
      {options.map((o) => (
        <button key={o} aria-pressed={o === value} onClick={() => onChange(o)} className="mono">
          {fmt(o)}
        </button>
      ))}
    </div>
  );
}
