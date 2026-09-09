"use client";

import { useState } from "react";
import { ArrowUpRight, FileUp, Film, Play, Repeat, UserPlus } from "lucide-react";
import CharacterGrid, { lookLabel } from "./CharacterGrid";
import Source from "./Source";
import { Note, NumSlider, Row, Seg } from "./Inspector";
import { AVATAR_PRESETS, DEFAULT_AVATAR_URL } from "@/lib/avatars";
import { DEMO_PHRASES, type DemoPhrase } from "@/lib/demo";
import type { Crop } from "@/lib/crop";
import type { PersonPick } from "@/lib/follow";

/** The look a new dancer is given: a bundled character, a custom VRM (a blob url), or the skeleton (null). */
export interface Look { avatarUrl: string | null; avatarName: string | null }

export interface AddProgress { stage: "loading" | "tracking"; done: number; total: number }

interface Props {
  /** There is a dance on the stage to copy. */
  hasDance: boolean;
  danceName: string | null;
  /** Seconds per beat, so entrances read musically. */
  beat: number;
  /** Looks already on the stage: a new dancer defaults to a fresh one. */
  usedLooks: (string | null)[];
  /** Another video being tracked for the new dancer. */
  progress: AddProgress | null;
  onAddThis: (look: Look, count: number, gapBeats: number) => void;
  onAddFile: (file: File, look: Look, crop?: Crop, follow?: PersonPick) => void;
  onAddSaved: (file: File, look: Look) => void;
  onAddExample: (phrase: DemoPhrase, look: Look) => void;
  onCancel: () => void;
}

type Mode = "this" | "video" | "saved" | "example";

/** The first bundled character nobody on the stage is wearing yet. */
function freshLook(used: (string | null)[]): Look {
  const preset = AVATAR_PRESETS.find((a) => !used.includes(a.url));
  return { avatarUrl: preset?.url ?? DEFAULT_AVATAR_URL, avatarName: null };
}

/** One dialog for every way of putting another dancer on the stage:
 *  who they are (a look), and what they dance (this dance again — alone
 *  or in canon — another video, a saved dance, or an example). */
export default function AddDancer({ hasDance, danceName, beat, usedLooks, progress, onAddThis, onAddFile, onAddSaved, onAddExample, onCancel }: Props) {
  const [look, setLook] = useState<Look>(() => freshLook(usedLooks));
  const [mode, setMode] = useState<Mode>(hasDance ? "this" : "video");
  const [count, setCount] = useState(1);
  const [gap, setGap] = useState(1);
  /** A clip is chosen and being framed: the picture takes the dialog. */
  const [framing, setFraming] = useState(false);
  const who = lookLabel(look.avatarUrl, look.avatarName);

  if (progress) {
    const percent = Math.min(100, Math.round(progress.done / Math.max(1, progress.total) * 100));
    const loading = progress.stage === "loading";
    return <div className="analysis-progress" role="status" aria-live="polite">
      <span className="progress-orbit"><span className="status-dot" /><span>{loading ? "…" : `${percent}%`}</span></span>
      <h3>{loading ? "Reading the video" : "Finding the movement"}</h3>
      <p>{loading ? "Getting the clip and the tracker ready." : `Following the dancer frame by frame. ${who} joins the stage when it’s done.`}</p>
      <progress max={100} value={loading ? undefined : percent} aria-label="Tracking progress" />
      <span className="subtle">Keep this tab open. Everything stays on your device.</span>
      <button className="btn" onClick={onCancel}>Cancel</button>
    </div>;
  }

  const chooseFile = (file: File) => onAddSaved(file, look);
  return <div className="add-dancer">
    {!framing && <>
      <section className="add-step">
        <header><span className="eyebrow">1 · Who</span><span className="add-step-value">{who}</span></header>
        <CharacterGrid avatar={look.avatarUrl !== null} avatarUrl={look.avatarUrl ?? DEFAULT_AVATAR_URL} avatarName={look.avatarName}
          onAvatar={(on) => setLook((l) => ({ avatarUrl: on ? (l.avatarUrl ?? DEFAULT_AVATAR_URL) : null, avatarName: on ? l.avatarName : null }))}
          onAvatarPreset={(url) => setLook({ avatarUrl: url, avatarName: null })}
          onAvatarFile={(f) => setLook({ avatarUrl: URL.createObjectURL(f), avatarName: f.name.replace(/\.vrm$/i, "") })} />
      </section>
      <section className="add-step">
        <header><span className="eyebrow">2 · What they dance</span></header>
        <div className="dialog-tabs" aria-label="What the new dancer dances">
          <button aria-pressed={mode === "this"} disabled={!hasDance} title={hasDance ? undefined : "Create a dance first"} onClick={() => setMode("this")}><Repeat size={17} />This dance</button>
          <button aria-pressed={mode === "video"} onClick={() => setMode("video")}><Film size={17} />Another video</button>
          <button aria-pressed={mode === "saved"} onClick={() => setMode("saved")}><FileUp size={17} />Saved dance</button>
          <button aria-pressed={mode === "example"} onClick={() => setMode("example")}><Play size={17} />Example</button>
        </div>
      </section>
    </>}

    {mode === "this" && hasDance && <div className="add-this">
      <Row label="How many" hint="Copies of this dance to add">
        <Seg label="How many" value={count} onChange={setCount} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
      </Row>
      <NumSlider label="Entrance" hint={count > 1 ? "Each dancer starts this many beats after the one before" : "Starts this many beats after you"} min={0} max={8} step={0.25} decimals={2} unit="beats" value={gap} onChange={setGap} />
      <Note>
        {count > 1
          ? `${count} more dancers doing ${danceName ?? "this dance"}, ${gap > 0 ? `each starting ${fmtBeats(gap)} (${(gap * beat).toFixed(2)} s) after the last: a canon.` : "all in unison."}`
          : `${who} does ${danceName ?? "this dance"} beside you, ${gap > 0 ? `starting ${fmtBeats(gap)} (${(gap * beat).toFixed(2)} s) later.` : "in unison."}`}
        {" "}Mirror, reverse, speed and placement can be changed afterwards in the Cast panel.
      </Note>
      <button className="btn primary dialog-primary" onClick={() => onAddThis(look, count, gap)}><UserPlus size={18} /> {count > 1 ? `Add ${count} dancers` : `Add ${who}`} to the stage</button>
    </div>}

    {mode === "video" && <div className="add-video">
      {!framing && <p className="dialog-note">A different clip, tracked on this device, danced by {who}. The dance on the stage now stays as it is.</p>}
      <Source mode="upload" busy={false} onFraming={setFraming} confirmLabel="Add to the stage" onFile={(file, crop, follow) => onAddFile(file, look, crop, follow)} />
    </div>}

    {mode === "saved" && <div className="import-score-flow">
      <p>A dance you downloaded earlier, danced by {who}. The dance on the stage now stays as it is.</p>
      <label className="upload-zone"><FileUp size={30} /><strong>Open a saved dance</strong><span>Choose a .vid2grid.json file · up to 25 MB</span>
        <input aria-label="Open saved dance for the new dancer" type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) chooseFile(f); e.currentTarget.value = ""; }} />
      </label>
    </div>}

    {mode === "example" && <div>
      <p className="dialog-note">A movement study for {who} to dance beside you. No video needed.</p>
      {DEMO_PHRASES.map((p) => <button key={p.id} className="example-row" onClick={() => onAddExample(p.id, look)}><Play size={18} /><span className="example-name">{p.name}<small>{p.detail}</small></span><span>{p.duration}</span><ArrowUpRight size={18} /></button>)}
    </div>}
  </div>;
}

function fmtBeats(n: number): string {
  return `${Math.round(n * 100) / 100} beat${Math.abs(n - 1) < 1e-9 ? "" : "s"}`;
}
