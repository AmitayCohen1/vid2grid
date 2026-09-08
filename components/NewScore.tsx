"use client";

import { useState } from "react";
import { ArrowUpRight, Camera, FileUp, Play, ShieldCheck, UploadCloud } from "lucide-react";
import Source from "./Source";
import { DEMO_PHRASES, type DemoPhrase } from "@/lib/demo";
import type { Crop } from "@/lib/crop";
import type { PersonPick } from "@/lib/follow";

export default function NewScore({ onFile, onImport, onDemo, busy, progress, loading, onCancel, initialMode = "upload" }: {
  onFile: (f: File, crop?: Crop, follow?: PersonPick) => void; onImport: (f: File) => void; onDemo: (p: DemoPhrase) => void;
  busy: boolean; progress: { done: number; total: number }; loading: boolean; onCancel: () => void;
  initialMode?: "upload" | "import";
}) {
  const [mode, setMode] = useState<"upload" | "record" | "import" | "examples">(initialMode);
  const percent = Math.min(100, Math.round(progress.done / Math.max(1, progress.total) * 100));
  if (busy) return <div className="analysis-progress" role="status" aria-live="polite">
    <span className="progress-orbit"><span className="status-dot" /><span>{loading ? "…" : `${percent}%`}</span></span>
    <h3>{loading ? "Preparing your video" : "Finding the movement"}</h3>
    <p>{loading ? "Reading your clip and getting the tracker ready." : "Following the dancer frame by frame. Your score will open when it’s ready."}</p>
    <progress max={100} value={loading ? undefined : percent} aria-label="Analysis progress" />
    <span className="subtle">Keep this tab open. Everything stays on your device.</span>
    <button className="btn" onClick={onCancel}>Cancel analysis</button>
  </div>;
  return <>
    <div className="dialog-tabs" aria-label="Choose your starting point">
      <button aria-pressed={mode === "upload"} onClick={() => setMode("upload")}><UploadCloud size={17} />Video</button>
      <button aria-pressed={mode === "record"} onClick={() => setMode("record")}><Camera size={17} />Camera</button>
      <button aria-pressed={mode === "import"} onClick={() => setMode("import")}><FileUp size={17} />Open score</button>
      <button aria-pressed={mode === "examples"} onClick={() => setMode("examples")}><Play size={17} />Examples</button>
    </div>
    {(mode === "upload" || mode === "record") && <Source key={mode} mode={mode} onFile={onFile} busy={false} />}
    {mode === "import" && <div className="import-score-flow"><p>Pick a previously downloaded vid2grid score to continue exploring it. The original video is not included in a score file.</p><label className="upload-zone"><FileUp size={30} /><strong>Open a saved score</strong><span>Choose a .vid2grid.json file · up to 25 MB</span><input aria-label="Open saved score" type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.currentTarget.value = ""; }} /></label></div>}
    {mode === "examples" && <div><p className="dialog-note">No video needed. Choose a movement study to try the studio.</p>{DEMO_PHRASES.map((p) => <button key={p.id} className="example-row" onClick={() => onDemo(p.id)}><Play size={18} /><span className="example-name">{p.name}<small>{p.detail}</small></span><span>{p.duration}</span><ArrowUpRight size={18} /></button>)}</div>}
    <p className="dialog-privacy"><ShieldCheck size={16} /> Private by design. Your files stay on this device.</p>
  </>;
}
