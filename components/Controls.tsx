"use client";

import { RotateCcw } from "lucide-react";
import CharacterGrid, { lookLabel } from "./CharacterGrid";
import { DEFAULT_GRID, type GridConfig } from "@/lib/grid";
import { DEFAULT_SMOOTH, type LiftMode, type SmoothConfig } from "@/lib/score";
import { Disclosure, Note, NumSlider, Section, Seg, Select, Switch } from "./Inspector";
import { MAX_SIZE, MIN_SIZE } from "@/lib/devices";

interface Props {
  panel: "dancer" | "grid";
  grid: GridConfig; smooth: SmoothConfig;
  onGrid: (g: GridConfig) => void; onSmooth: (s: SmoothConfig) => void;
  showRaw: boolean; onShowRaw: (b: boolean) => void;
  kinesphere: boolean; onKinesphere: (b: boolean) => void;
  avatar: boolean; onAvatar: (b: boolean) => void; avatarUrl: string; avatarName: string | null;
  onAvatarFile: (f: File) => void; onAvatarPreset: (url: string) => void;
  showOverlay: boolean; onShowOverlay: (b: boolean) => void;
  lift: LiftMode; onLift: (m: LiftMode) => void; canLift: boolean;
  motion: "stepped" | "smooth"; onMotion: (m: "stepped" | "smooth") => void;
  /** Scale of the figure on stage and in the video; 1 = the tracked body. */
  size: number; onSize: (s: number) => void;
  /** Side by side and Video views: the character and the cast drawn inside the recording, beside the person. */
  inVideo: boolean; onInVideo: (b: boolean) => void;
  /** Metres to the person's screen-right the character stands in the video. */
  beside: number; onBeside: (m: number) => void;
  /** Seconds the character in the video runs behind the person. */
  selfDelay: number; onSelfDelay: (s: number) => void;
}
const PRESETS = [
  { name: "Simple", step: 45, hint: "45° steps. Big gestures, fewer changes." },
  { name: "Balanced", step: 22.5, hint: "22.5° steps. A clear view of most movement." },
  { name: "Detailed", step: 11.25, hint: "11.25° steps. Smaller gestures, more changes." },
];
const STEPS = [11.25, 22.5, 45].map((n) => ({ value: String(n), label: `${n}°` }));

export default function Controls(p: Props) {
  if (p.panel === "dancer") return <>
    <Section title="Motion">
      <Seg label="Motion" value={p.motion} onChange={p.onMotion} options={[
        { value: "smooth", label: "Smooth", hint: "True to the video. Best for watching and sharing." },
        { value: "stepped", label: "Stepped", hint: "Snapped to the grid. This is what the notation reads." },
      ]} />
    </Section>
    <Section title="Look" aside={<span className="insp-aside">{lookLabel(p.avatar ? p.avatarUrl : null, p.avatarName)}</span>}>
      <CharacterGrid {...p} />
      <NumSlider label="Size" hint="How big the figure is drawn, on stage and in the video. 1 is your tracked size; the dance itself keeps the real body." min={MIN_SIZE} max={MAX_SIZE} step={0.05} decimals={2} unit="×" value={p.size} onChange={p.onSize} />
    </Section>
    <Section title="Overlays">
      <Switch label={p.motion === "smooth" ? "Snapped ghost" : "Original ghost"}
        hint={p.motion === "smooth" ? "A translucent figure of the grid-snapped dance." : "A translucent figure before grid snapping."}
        checked={p.showRaw} onChange={p.onShowRaw} />
      <Switch label="Kinesphere" hint="Laban's icosahedron around the dancer, with the movement grid on its surface. Each limb's current direction is lit from the centre."
        checked={p.kinesphere} onChange={p.onKinesphere} />
      <Switch label="Tracking points" hint={p.canLift ? "Detected joints over the original video." : "Available when you add a video."}
        checked={p.showOverlay} onChange={p.onShowOverlay} disabled={!p.canLift} />
    </Section>
    <Section title="In the video">
      <Switch label="Dance in the video" hint={p.canLift ? "The character and the cast inside the recording, at your scale, on your floor." : "Available when you add a video."}
        checked={p.inVideo} onChange={p.onInVideo} disabled={!p.canLift} />
      <NumSlider label="Beside" hint="Where the character stands: metres to your right on screen (negative = left, 0 = over you)" min={-3} max={3} step={0.1} decimals={1} unit="m" value={p.beside} disabled={!p.canLift || !p.inVideo} onChange={p.onBeside} />
      <NumSlider label="Delay" hint="The character runs this far behind you — an echo of yourself. 0 = in unison." min={0} max={4} step={0.05} decimals={2} unit="s" value={p.selfDelay} disabled={!p.canLift || !p.inVideo} onChange={p.onSelfDelay} />
    </Section>
  </>;

  const preset = PRESETS.find((x) => x.step === p.grid.azStep && x.step === p.grid.elStep)?.step ?? 0;
  return <>
    <Section title="Detail" aside={<span className="insp-aside mono">{p.grid.azStep}° / {p.grid.elStep}°</span>}>
      <Seg label="Grid detail" value={preset} onChange={(step) => p.onGrid({ ...p.grid, azStep: step, elStep: step })}
        options={PRESETS.map((x) => ({ value: x.step, label: x.name, hint: x.hint }))} />
      <Note>Directions snap to the grid as you adjust. The dance updates live; nothing is re-tracked.</Note>
    </Section>
    <Disclosure title="Grid" open={preset === 0}>
      <Select label="Azimuth" hint="Horizontal direction steps" value={String(p.grid.azStep)} options={STEPS} onChange={(v) => p.onGrid({ ...p.grid, azStep: +v })} />
      <Select label="Elevation" hint="Vertical direction steps" value={String(p.grid.elStep)} options={STEPS} onChange={(v) => p.onGrid({ ...p.grid, elStep: +v })} />
      <Select label="Facing" hint="Turning direction steps" value={String(p.grid.facingStep)} options={[22.5, 45, 90].map((n) => ({ value: String(n), label: `${n}°` }))} onChange={(v) => p.onGrid({ ...p.grid, facingStep: +v })} />
      <NumSlider label="Hysteresis" hint="Ignore small wobbles near a grid boundary." value={p.grid.hysteresis} min={0} max={0.5} step={0.05} decimals={2} onChange={(hysteresis) => p.onGrid({ ...p.grid, hysteresis })} />
      <NumSlider label="Dwell" hint="Frames a new direction must last before it is accepted." value={p.grid.minDwell} min={1} max={10} step={1} unit="fr" onChange={(minDwell) => p.onGrid({ ...p.grid, minDwell })} />
    </Disclosure>
    <Disclosure title="Tracking" aside={!p.canLift ? <span className="insp-aside">baked in</span> : undefined}>
      {!p.canLift && <Note>Already baked into this dance. Add a video to adjust.</Note>}
      <Select label="Depth" value={p.lift} disabled={!p.canLift} options={[{ value: "anchored", label: "Video-anchored" }, { value: "world", label: "Tracker 3D" }]} onChange={(v) => p.onLift(v as LiftMode)} />
      <NumSlider label="Rest" hint="Lower values reduce jitter when the dancer is still." value={p.smooth.minCutoff} min={0.3} max={5} step={0.1} decimals={1} unit="Hz" disabled={!p.canLift} onChange={(minCutoff) => p.onSmooth({ ...p.smooth, minCutoff })} />
      <NumSlider label="Follow" hint="Higher values respond faster to quick gestures." value={p.smooth.beta} min={0} max={3} step={0.05} decimals={2} disabled={!p.canLift} onChange={(beta) => p.onSmooth({ ...p.smooth, beta })} />
    </Disclosure>
    <div className="insp-actions">
      <button className="insp-btn" onClick={() => { p.onGrid(DEFAULT_GRID); if (p.canLift) { p.onSmooth(DEFAULT_SMOOTH); p.onLift("anchored"); } }}><RotateCcw size={12} /> Reset to defaults</button>
    </div>
  </>;
}
