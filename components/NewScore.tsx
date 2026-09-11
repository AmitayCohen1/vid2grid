"use client";

import { useState } from "react";
import { ArrowUpRight, Camera, FileUp, Play, Radio, ShieldCheck, Target, UploadCloud } from "lucide-react";
import Source from "./Source";
import { Switch } from "./Inspector";
import { DEMO_PHRASES, type DemoPhrase } from "@/lib/demo";
import type { Crop } from "@/lib/crop";
import type { PersonPick } from "@/lib/follow";

export interface DanceAlongChoice { mirror: boolean }

export default function NewScore({ onFile, onImport, onDemo, onLive, danceName, busy, progress, loading, onCancel, initialMode = "upload" }: {
  onFile: (f: File, crop?: Crop, follow?: PersonPick[]) => void; onImport: (f: File) => void; onDemo: (p: DemoPhrase) => void;
  /** Open the studio on the camera and score the movement as it happens — along to the current dance, when asked. */
  onLive: (along: DanceAlongChoice | null) => void;
  /** The dance on the stage now, offered as something to dance along to. */
  danceName: string | null;
  busy: boolean; progress: { done: number; total: number }; loading: boolean; onCancel: () => void;
  initialMode?: "upload" | "import" | "live";
}) {
  const [mode, setMode] = useState<"upload" | "record" | "live" | "import" | "examples">(initialMode);
  /** A clip is chosen and being framed: the dialog is all picture, the mode tabs step aside. */
  const [framing, setFraming] = useState(false);
  const [along, setAlong] = useState(false);
  const [mirror, setMirror] = useState(true);
  const percent = Math.min(100, Math.round(progress.done / Math.max(1, progress.total) * 100));
  if (busy) return <div className="analysis-progress" role="status" aria-live="polite">
    <span className="progress-orbit"><span className="status-dot" /><span>{loading ? "…" : `${percent}%`}</span></span>
    <h3>{loading ? "Preparing your video" : "Finding the movement"}</h3>
    <p>{loading ? "Reading your clip and getting the tracker ready." : "Following the dancer frame by frame. Your dance will open when it’s ready."}</p>
    <progress max={100} value={loading ? undefined : percent} aria-label="Analysis progress" />
    <span className="subtle">Keep this tab open. Everything stays on your device.</span>
    <button className="btn" onClick={onCancel}>Cancel analysis</button>
  </div>;
  return <>
    {!framing && <div className="dialog-tabs" aria-label="Choose your starting point">
      <button aria-pressed={mode === "upload"} onClick={() => setMode("upload")}><UploadCloud size={17} />Video</button>
      <button aria-pressed={mode === "record"} onClick={() => setMode("record")}><Camera size={17} />Camera</button>
      <button aria-pressed={mode === "live"} onClick={() => setMode("live")}><Radio size={17} />Live</button>
      <button aria-pressed={mode === "import"} onClick={() => setMode("import")}><FileUp size={17} />Open dance</button>
      <button aria-pressed={mode === "examples"} onClick={() => setMode("examples")}><Play size={17} />Examples</button>
    </div>}
    {(mode === "upload" || mode === "record") && <Source key={mode} mode={mode} onFile={onFile} busy={false} onFraming={setFraming} />}
    {mode === "live" && <div className="import-score-flow">
      <p>Dance in front of the camera and watch the dance form as you move — the figure, the grid, and your cast, all in real time. When you finish, the take becomes a dance like any other, video included.</p>
      {danceName && <div className="along-box">
        <Switch label={`Dance along to ${danceName}`} hint="The dance on the stage plays beside you and every limb is scored against it, live. You get a report when you finish." checked={along} onChange={setAlong} />
        <Switch label="As a mirror" hint="Copy them the way you would on a screen: their right is your left." checked={mirror} disabled={!along} onChange={setMirror} />
      </div>}
      <button className="upload-zone live-zone" onClick={() => onLive(along && danceName ? { mirror } : null)}>
        {along && danceName ? <Target size={30} /> : <Radio size={30} />}
        <strong>{along && danceName ? "Dance along" : "Go live"}</strong>
        <span>Whole body in frame, still camera · up to 2 minutes</span>
      </button>
    </div>}
    {mode === "import" && <div className="import-score-flow"><p>Pick a previously downloaded Visual Elbow dance to continue exploring it. The original video is not included in a dance file.</p><label className="upload-zone"><FileUp size={30} /><strong>Open a saved dance</strong><span>Choose a .vid2grid.json file · up to 25 MB</span><input aria-label="Open saved dance" type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.currentTarget.value = ""; }} /></label></div>}
    {mode === "examples" && <div><p className="dialog-note">No video needed. Choose a movement study to try the studio.</p>{DEMO_PHRASES.map((p) => <button key={p.id} className="example-row" onClick={() => onDemo(p.id)}><Play size={18} /><span className="example-name">{p.name}<small>{p.detail}</small></span><span>{p.duration}</span><ArrowUpRight size={18} /></button>)}</div>}
    {!framing && <p className="dialog-privacy"><ShieldCheck size={16} /> Private by design. Your files stay on this device.</p>}
  </>;
}
