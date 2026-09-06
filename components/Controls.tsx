"use client";

import { Activity, Box, ChevronDown, Compass, Eye, Ghost, Grid2X2, Layers, PersonStanding, RotateCcw, ScanLine, SlidersHorizontal, Upload, Waves } from "lucide-react";
import { AVATAR_PRESETS } from "@/lib/avatars";
import { DEFAULT_GRID, type GridConfig } from "@/lib/grid";
import { DEFAULT_SMOOTH, type LiftMode, type SmoothConfig } from "@/lib/score";

interface Props {
  panel: "dancer" | "grid";
  grid: GridConfig; smooth: SmoothConfig;
  onGrid: (g: GridConfig) => void; onSmooth: (s: SmoothConfig) => void;
  showRaw: boolean; onShowRaw: (b: boolean) => void;
  avatar: boolean; onAvatar: (b: boolean) => void; avatarUrl: string; avatarName: string | null;
  onAvatarFile: (f: File) => void; onAvatarPreset: (url: string) => void;
  showOverlay: boolean; onShowOverlay: (b: boolean) => void;
  lift: LiftMode; onLift: (m: LiftMode) => void; canLift: boolean;
  motion: "stepped" | "smooth"; onMotion: (m: "stepped" | "smooth") => void;
}
const PRESETS = [
  { name: "Simple", step: 45, icon: Box, detail: "Big gestures. Fewer changes." },
  { name: "Balanced", step: 22.5, icon: Grid2X2, detail: "A clear view of most movement." },
  { name: "Detailed", step: 11.25, icon: Layers, detail: "Smaller gestures. More changes." },
];

export default function Controls(p: Props) {
  if (p.panel === "dancer") return <div className="settings-content">
    <div className="setting-heading"><Waves size={22} /><div><h3>How should the movement read?</h3><p>The same tracking, shown two ways. The score underneath is always the snapped one.</p></div></div>
    <div className="choice-cards two">
      <button aria-pressed={p.motion === "smooth"} onClick={() => p.onMotion("smooth")}><Waves size={27} /><strong>Smooth</strong><span>True to the video. Best for watching and sharing.</span></button>
      <button aria-pressed={p.motion === "stepped"} onClick={() => p.onMotion("stepped")}><Grid2X2 size={27} /><strong>Stepped</strong><span>Snapped to the grid. This is what the notation reads.</span></button>
    </div>
    <div className="setting-heading"><PersonStanding size={22} /><div><h3>How should your dancer look?</h3><p>Switch the appearance without changing the movement.</p></div></div>
    <div className="choice-cards two">
      <button aria-pressed={!p.avatar} onClick={() => p.onAvatar(false)}><Activity size={27} /><strong>Skeleton</strong><span>See every joint and limb clearly.</span></button>
      <button aria-pressed={p.avatar} onClick={() => p.onAvatar(true)}><PersonStanding size={27} /><strong>Character</strong><span>See the phrase on a 3D avatar.</span></button>
    </div>
    {p.avatar && <div className="avatar-picker"><label className="form-field"><span>Choose a character</span><select value={p.avatarName ? "custom" : p.avatarUrl} onChange={(e) => p.onAvatarPreset(e.target.value)}>{AVATAR_PRESETS.map((a) => <option key={a.url} value={a.url}>{a.label}</option>)}{p.avatarName && <option value="custom">{p.avatarName}</option>}</select></label><label className="btn"><Upload size={17} /> Use your own avatar<input aria-label="Choose a VRM avatar" type="file" accept=".vrm" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onAvatarFile(f); e.currentTarget.value = ""; }} /></label><p className="dialog-note">Have a character from VRoid? Open its .vrm file here.</p></div>}
    <div className="setting-heading"><Eye size={22} /><div><h3>Helpful overlays</h3><p>Choose what you see alongside the score.</p></div></div>
    <Toggle icon={<Ghost size={20} />} title={p.motion === "smooth" ? "Snapped movement" : "Original movement"} detail={p.motion === "smooth" ? "Show a translucent figure of the grid-snapped score." : "Show a translucent figure before grid snapping."} checked={p.showRaw} onChange={p.onShowRaw} />
    <Toggle icon={<ScanLine size={20} />} title="Video tracking points" detail={p.canLift ? "Show detected joints over your original video." : "Available when you add a video."} checked={p.showOverlay} onChange={p.onShowOverlay} disabled={!p.canLift} />
  </div>;
  return <div className="settings-content">
    <div className="setting-heading"><Compass size={22} /><div><h3>How much movement detail?</h3><p>The grid turns continuous movement into clear directions. Your score updates as you adjust it.</p></div></div>
    <div className="choice-cards three">{PRESETS.map(({ name, step, icon: Icon, detail }) => <button key={name} aria-pressed={p.grid.azStep === step && p.grid.elStep === step} onClick={() => p.onGrid({ ...p.grid, azStep: step, elStep: step })}><Icon size={25} /><strong>{name}</strong><span>{detail}</span><small>{step}° steps</small></button>)}</div>
    <details className="advanced-settings"><summary><SlidersHorizontal size={18} /> Advanced tuning <ChevronDown size={17} /></summary><div className="settings-content">
      <p className="dialog-note">Fine-tune direction, stability, and tracking. Balanced defaults work well for most clips.</p>
      <Select label="Horizontal direction (azimuth)" value={p.grid.azStep} options={[11.25, 22.5, 45]} onChange={(azStep) => p.onGrid({ ...p.grid, azStep })} />
      <Select label="Vertical direction (elevation)" value={p.grid.elStep} options={[11.25, 22.5, 45]} onChange={(elStep) => p.onGrid({ ...p.grid, elStep })} />
      <Select label="Turning direction (facing)" value={p.grid.facingStep} options={[22.5, 45, 90]} onChange={(facingStep) => p.onGrid({ ...p.grid, facingStep })} />
      <Slider label="Ignore small wobbles" detail="Higher values keep a direction steadier near a grid boundary." value={p.grid.hysteresis} display={p.grid.hysteresis.toFixed(2)} min={0} max={0.5} step={0.05} onChange={(hysteresis) => p.onGrid({ ...p.grid, hysteresis })} />
      <Slider label="Hold each new direction" detail="How many frames a direction must last before it is accepted." value={p.grid.minDwell} display={p.grid.minDwell + " frames"} min={1} max={10} step={1} onChange={(minDwell) => p.onGrid({ ...p.grid, minDwell })} />
      <fieldset disabled={!p.canLift} className="tracking-settings"><legend>Video tracking</legend>{!p.canLift && <p className="dialog-note">These settings are already baked into this score. Add a video to adjust them.</p>}
        <label className="form-field"><span>Depth estimation</span><select value={p.lift} onChange={(e) => p.onLift(e.target.value as LiftMode)}><option value="anchored">Video-anchored (recommended)</option><option value="world">Tracker’s 3D estimate</option></select></label>
        <Slider label="Resting smoothness" detail="Lower values reduce jitter when the dancer is still." value={p.smooth.minCutoff} display={p.smooth.minCutoff.toFixed(1) + " Hz"} min={0.3} max={5} step={0.1} onChange={(minCutoff) => p.onSmooth({ ...p.smooth, minCutoff })} />
        <Slider label="Follow fast movement" detail="Higher values respond faster to quick gestures." value={p.smooth.beta} display={p.smooth.beta.toFixed(2)} min={0} max={3} step={0.05} onChange={(beta) => p.onSmooth({ ...p.smooth, beta })} />
      </fieldset>
    </div></details>
    <button className="btn settings-reset" onClick={() => { p.onGrid(DEFAULT_GRID); if (p.canLift) { p.onSmooth(DEFAULT_SMOOTH); p.onLift("anchored"); } }}><RotateCcw size={16} /> Restore recommended settings</button>
  </div>;
}
export function Toggle({ icon, title, detail, checked, onChange, disabled = false }: { icon: React.ReactNode; title: string; detail: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <label className={`setting-toggle ${disabled ? "is-disabled" : ""}`}>{icon}<span><strong>{title}</strong><small>{detail}</small></span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /></label>;
}
function Select({ label, value, options, onChange }: { label: string; value: number; options: number[]; onChange: (n: number) => void }) {
  return <label className="form-field"><span>{label}</span><select value={value} onChange={(e) => onChange(Number(e.target.value))}>{options.map((n) => <option key={n} value={n}>{n}° steps</option>)}</select></label>;
}
function Slider({ label, detail, value, display, min, max, step, onChange }: { label: string; detail: string; value: number; display: string; min: number; max: number; step: number; onChange: (n: number) => void }) {
  return <label className="setting-slider"><span><strong>{label}</strong><output>{display}</output></span><small>{detail}</small><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}
