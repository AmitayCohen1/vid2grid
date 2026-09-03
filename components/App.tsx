"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { FileDown, FileUp, Film, Moon, Sun } from "lucide-react";
import Source from "./Source";
import { AVATAR_PRESETS, DEFAULT_AVATAR_URL } from "./Avatar";
import VideoPane from "./VideoPane";
import Stage from "./Stage";
import Timeline from "./Timeline";
import BoneTable from "./BoneTable";
import Controls from "./Controls";
import Objects, { DEFAULT_OBJECTS, Drawing, type ObjectsOptions } from "./Objects";
import { DEFAULT_GRID, type GridConfig } from "@/lib/grid";
import { DEFAULT_SMOOTH, type LiftMode, type Score, type SmoothConfig, type SourceInfo, frameAt, measureBody, parseScore, rawPoses, serializeScore, smoothPoses, snapPoses } from "@/lib/score";
import { fillGaps, getLandmarker, trackVideo, type TrackedFrame } from "@/lib/tracker";
import type { BoneId } from "@/lib/skeleton";
import type { Body } from "@/lib/fk";
import type { Pose } from "@/lib/pose";

type Phase = "idle" | "loading" | "tracking" | "ready" | "error";
const SAMPLE_FPS = 30;
const LS_KEY = "vid2grid:last-score";

interface Analysis {
  tracked: TrackedFrame[];
  source: SourceInfo;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 1 });
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(true);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [imported, setImported] = useState<Score | null>(null);
  const [grid, setGrid] = useState<GridConfig>(DEFAULT_GRID);
  const [smooth, setSmooth] = useState<SmoothConfig>(DEFAULT_SMOOTH);
  const [lift, setLift] = useState<LiftMode>("anchored");

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<BoneId | null>(null);
  const [showRaw, setShowRaw] = useState(true);
  const [avatar, setAvatar] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(DEFAULT_AVATAR_URL);
  const [avatarName, setAvatarName] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [view, setView] = useState<"score" | "duet" | "objects">("score");
  const [objects, setObjects] = useState<ObjectsOptions>(DEFAULT_OBJECTS);

  // Warm the model while the user picks a clip.
  useEffect(() => { getLandmarker().catch(() => {}); }, []);

  // Restore the last score (figure only; the video is not kept).
  useEffect(() => {
    let sc: Score | null = null;
    try {
      const s = localStorage.getItem(LS_KEY);
      if (s) sc = parseScore(s);
    } catch { /* ignore */ }
    if (!sc) return;
    const restored = sc;
    // Deferred so the restore is a subscription-style update, not a synchronous cascade.
    const id = setTimeout(() => { setImported(restored); setGrid(restored.grid); setSmooth(restored.smooth); setShowSource(false); setPhase("ready"); }, 0);
    return () => clearTimeout(id);
  }, []);

  /* ---------- derive the score ---------- */

  const extractions = useMemo(() => (analysis ? fillGaps(analysis.tracked, analysis.source.fps) : null), [analysis]);
  const raw: Pose[] | null = useMemo(
    () => (extractions ? smoothPoses(rawPoses(extractions, lift), smooth) : imported?.raw ?? null),
    [extractions, smooth, imported, lift],
  );
  const body: Body | null = useMemo(() => (extractions ? measureBody(extractions, lift) : imported?.body ?? null), [extractions, imported, lift]);
  const source = analysis?.source ?? imported?.source ?? null;
  const score: Score | null = useMemo(() => {
    if (!raw || !body || !source || !raw.length) return null;
    const { frames, keyframes } = snapPoses(raw, grid);
    return { version: 1, source, grid, smooth, lift, body, raw, frames, keyframes };
  }, [raw, body, source, grid, smooth, lift]);

  useEffect(() => {
    if (!score) return;
    try { localStorage.setItem(LS_KEY, serializeScore(score)); } catch { /* quota */ }
  }, [score]);

  const fi = score ? frameAt(score, time) : 0;
  const snappedPose = score?.frames[fi] ?? null;
  const rawPose = score?.raw[fi] ?? null;
  const overlay = analysis?.tracked[fi]?.image ?? null;

  /* ---------- getting a clip in ---------- */

  const onFile = useCallback((file: File) => {
    abortRef.current?.abort();
    if (src) URL.revokeObjectURL(src);
    setAnalysis(null);
    setImported(null);
    setPlaying(false);
    setTime(0);
    setError(null);
    setPhase("loading");
    setShowSource(false);
    fileNameRef.current = file.name;
    setSrc(URL.createObjectURL(file));
  }, [src]);
  const fileNameRef = useRef("clip");

  const onLoaded = useCallback(async (video: HTMLVideoElement) => {
    setVideoEl(video);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // MediaRecorder webm files often report Infinity; force the duration to resolve.
      if (!isFinite(video.duration)) {
        await new Promise<void>((resolve) => {
          const done = () => { video.removeEventListener("durationchange", done); resolve(); };
          video.addEventListener("durationchange", done);
          video.currentTime = 1e101;
        });
        video.currentTime = 0;
      }
      video.pause();
      setPhase("tracking");
      const fps = SAMPLE_FPS;
      const total = Math.floor(video.duration * fps);
      setProgress({ done: 0, total });
      const tracked = await trackVideo(video, {
        fps,
        signal: ac.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (ac.signal.aborted) return;
      const detected = tracked.filter((f) => f.extraction).length;
      if (!detected) throw new Error("No person detected in this clip. Try a clip with your whole body in frame.");
      if (typeof window !== "undefined") (window as unknown as { __vid2grid?: unknown }).__vid2grid = { tracked };
      setAnalysis({
        tracked,
        source: { name: fileNameRef.current, duration: video.duration, fps, width: video.videoWidth, height: video.videoHeight },
      });
      video.currentTime = 0;
      setTime(0);
      setPhase("ready");
    } catch (e) {
      if (ac.signal.aborted) return; // superseded by a newer clip
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  /* ---------- playback ---------- */

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    const d = score?.source.duration ?? v?.duration ?? 0;
    const tt = Math.max(0, Math.min(d, t));
    setTime(tt);
    if (v && analysis) v.currentTime = tt;
  }, [score, analysis]);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  useEffect(() => {
    if (!playing || !score) return;
    const v = videoRef.current;
    const hasVideo = !!(v && analysis);
    let raf = 0;
    const t0 = performance.now();
    const start = time;
    if (hasVideo) { if (v.ended || v.currentTime >= v.duration - 0.02) v.currentTime = 0; v.play().catch(() => {}); }
    let lastFrame = -1;
    const tick = () => {
      const t = hasVideo ? v.currentTime : start + (performance.now() - t0) / 1000;
      const d = score.source.duration;
      if (t >= d - 1e-3 || (hasVideo && v.ended)) { setTime(d); setPlaying(false); return; }
      const f = frameAt(score, t);
      if (f !== lastFrame) { lastFrame = f; setTime(t); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); if (hasVideo) v.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, score, analysis]);

  const step = useCallback((n: number) => {
    if (!score) return;
    setPlaying(false);
    seek((frameAt(score, time) + n) / score.source.fps);
  }, [score, time, seek]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); step(e.shiftKey ? -10 : -1); }
      else if (e.code === "ArrowRight") { e.preventDefault(); step(e.shiftKey ? 10 : 1); }
      else if (e.code === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, step]);

  /* ---------- export / import ---------- */

  const exportJson = () => {
    if (!score) return;
    const blob = new Blob([serializeScore(score)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${score.source.name.replace(/\.[^.]+$/, "")}.vid2grid.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = (file: File) => {
    file.text().then((t) => {
      const sc = parseScore(t);
      if (src) URL.revokeObjectURL(src);
      setSrc(null); setAnalysis(null); setImported(sc); setGrid(sc.grid); setSmooth(sc.smooth);
      setTime(0); setPlaying(false); setShowSource(false); setPhase("ready"); setError(null);
      setView((v) => (v === "duet" ? "score" : v)); // duet needs a video
    }).catch((e) => { setError(String(e)); setPhase("error"); });
  };

  const busy = phase === "loading" || phase === "tracking";

  /* ---------- the character ---------- */

  const onAvatarFile = useCallback((file: File) => {
    setAvatarUrl((old) => {
      if (old.startsWith("blob:")) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    setAvatarName(file.name.replace(/\.vrm$/i, ""));
    setAvatar(true);
  }, []);
  const onAvatarPreset = useCallback((url: string) => {
    setAvatarUrl((old) => {
      if (old.startsWith("blob:")) URL.revokeObjectURL(old);
      return url;
    });
    setAvatarName(null);
    setAvatar(true);
  }, []);

  /* ---------- layout ---------- */

  return (
    <div className="flex flex-col h-dvh">
      <header className="flex items-center gap-3 px-4 h-13 border-b bg-card text-sm shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold tracking-tight text-[15px]">vid2grid</span>
          <span className="font-serif italic text-muted-foreground text-[13px] hidden sm:inline">a movement language</span>
        </div>
        <div className="seg ml-3 text-xs">
          <button aria-pressed={view === "score"} onClick={() => setView("score")}>score</button>
          <button aria-pressed={view === "duet"} disabled={!src} className="disabled:opacity-40 disabled:cursor-not-allowed" title={src ? "video and 3D dancer side by side" : "needs a video clip"} onClick={() => setView("duet")}>duet</button>
          <button aria-pressed={view === "objects"} onClick={() => setView("objects")}>objects</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn" onClick={() => setShowSource((s) => !s)}><Film size={14} />{showSource ? "hide source" : "new clip"}</button>
          <label className="btn cursor-pointer"><FileUp size={14} />import<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.currentTarget.value = ""; }} /></label>
          <button className="btn" onClick={exportJson} disabled={!score}><FileDown size={14} />export</button>
          <ThemeToggle />
        </div>
      </header>

      {showSource && (
        <div className="px-4 py-4 border-b bg-card/50 shrink-0">
          <div className="max-w-3xl w-full mx-auto">
            <Source onFile={onFile} busy={busy} />
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-xs">{error}</div>
      )}

      <main className={`flex-1 min-h-0 grid grid-cols-1 grid-rows-[auto_1fr] lg:grid-rows-1 gap-px bg-border ${view === "duet" ? "lg:grid-cols-2" : "lg:grid-cols-[minmax(280px,1fr)_2fr_minmax(260px,0.9fr)]"}`}>
        {/* left: video + readouts (in duet the video takes the whole column) */}
        <section className="bg-background flex flex-col min-h-0">
          <div className={`relative bg-black ${view === "duet" ? "flex-1 min-h-[320px] lg:min-h-0" : "aspect-video lg:aspect-auto lg:h-[38%] shrink-0"}`}>
            <VideoPane ref={videoRef} src={src} overlay={overlay} showOverlay={showOverlay} onLoaded={onLoaded} />
            {busy && (
              <div className="absolute inset-0 grid place-items-center bg-black/60">
                <div className="text-center text-xs text-white">
                  <div className="mb-2 mono">{phase === "loading" ? "loading clip…" : `tracking ${progress.done}/${progress.total}`}</div>
                  <div className="w-48 h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full bg-white transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className={`flex-1 min-h-0 overflow-auto ${view === "duet" ? "hidden" : ""}`}>
            {snappedPose && rawPose ? (
              <BoneTable snapped={snappedPose} raw={rawPose} selected={selected} onSelect={setSelected} />
            ) : (
              <Empty />
            )}
          </div>
        </section>

        {/* centre: the stage, or the annotated video */}
        <section className="bg-background min-h-[320px] lg:min-h-0 relative">
          {score && body ? (
            view === "objects" ? (
              <Objects score={score} overlays={analysis ? analysis.tracked.map((t) => t.image) : null} video={analysis ? videoEl : null} frame={fi} options={objects} />
            ) : (
              <Stage pose={snappedPose} raw={rawPose} body={body} grid={grid} showRaw={showRaw} avatar={avatar} avatarUrl={avatarUrl} selected={selected} onSelect={setSelected} />
            )
          ) : (
            <div className="w-full h-full grid place-items-center font-serif italic text-muted-foreground">the stage</div>
          )}
          {selected && view === "score" && (
            <div className="absolute top-2 left-2 text-[11px] text-[#f0b429] bg-black/60 rounded px-2 py-1 mono">
              {selected} · yellow = snapped cell · white = raw
            </div>
          )}
          {view === "duet" && score && (
            <div className="absolute top-2 right-2 flex flex-col items-end gap-1.5">
              <div className="seg text-xs shadow-sm">
                <button aria-pressed={!avatar} onClick={() => setAvatar(false)}>stick figure</button>
                <button aria-pressed={avatar} onClick={() => setAvatar(true)}>character</button>
              </div>
              {avatar && (
                <div className="flex flex-wrap justify-end gap-1 max-w-72">
                  {AVATAR_PRESETS.map((p) => {
                    const active = !avatarName && avatarUrl === p.url;
                    return (
                      <button
                        key={p.url}
                        onClick={() => onAvatarPreset(p.url)}
                        className={`rounded-md border px-1.5 py-0.5 text-[11px] shadow-sm transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  {avatarName && (
                    <span className="rounded-md border border-primary bg-primary text-primary-foreground px-1.5 py-0.5 text-[11px] truncate max-w-36">{avatarName}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* right: controls (hidden in duet — the split takes the full width) */}
        <section className={`bg-background flex-col min-h-0 overflow-auto ${view === "duet" ? "hidden" : "flex"}`}>
          {view === "objects" && score ? (
            <>
              <div className="label px-4 pt-4">synchronous objects</div>
              <div className="text-[13px] flex flex-col gap-2.5 p-4">
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={objects.traces} onChange={(e) => setObjects({ ...objects, traces: e.target.checked })} /> traces of hands, feet, head</label>
                <label className="grid grid-cols-[7.5rem_1fr] items-center gap-2"><span className="text-muted-foreground mono text-xs">trail {objects.trailSeconds.toFixed(1)} s</span><input type="range" min={0.2} max={6} step={0.1} value={objects.trailSeconds} onChange={(e) => setObjects({ ...objects, trailSeconds: +e.target.value })} /></label>
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={objects.alignments} onChange={(e) => setObjects({ ...objects, alignments: e.target.checked })} /> alignments (∥ parallel · ═ collinear)</label>
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={objects.density} onChange={(e) => setObjects({ ...objects, density: e.target.checked })} /> movement density</label>
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={objects.video} onChange={(e) => setObjects({ ...objects, video: e.target.checked })} /> show video plate</label>
              </div>
              <div className="px-4 text-xs text-muted-foreground">generative drawing — the whole clip&apos;s traces, weight by speed</div>
              <div className="m-4 mt-2 aspect-video card overflow-hidden"><Drawing score={score} overlays={analysis ? analysis.tracked.map((t) => t.image) : null} /></div>
              <div className="px-4 pb-4 text-[11px] text-muted-foreground leading-relaxed">After Forsythe/OSU&apos;s <em className="font-serif">Synchronous Objects</em> (2009): the dance as data — traces, alignments, density, drawing.</div>
            </>
          ) : (<>
          <Controls grid={grid} smooth={smooth} onGrid={setGrid} onSmooth={setSmooth} lift={lift} onLift={setLift} canLift={!!analysis} showRaw={showRaw} onShowRaw={setShowRaw} avatar={avatar} onAvatar={setAvatar} avatarUrl={avatarUrl} avatarName={avatarName} onAvatarFile={onAvatarFile} onAvatarPreset={onAvatarPreset} showOverlay={showOverlay} onShowOverlay={setShowOverlay} />
          {score && (
            <div className="px-4 pb-4 text-[11px] text-muted-foreground leading-relaxed">
              <div className="mono">{score.source.name}</div>
              <div>{score.frames.length} frames @ {score.source.fps} fps · {score.keyframes.length} keyframes · body {(score.body.lengths.torso + score.body.lengths.rthigh + score.body.lengths.rshin).toFixed(2)} m torso+leg</div>
              <div className="mt-2">Click a limb (or a row) to see its grid sphere. Space plays; ←/→ step frames.</div>
            </div>
          )}
          </>)}
        </section>
      </main>

      {score && (
        <footer className="border-t bg-card px-4 py-2.5 shrink-0">
          <Timeline score={score} time={time} playing={playing} onSeek={seek} onTogglePlay={togglePlay} onStep={step} selected={selected} onSelect={setSelected} />
        </footer>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="p-5 text-[13px] text-muted-foreground leading-relaxed">
      <p className="font-serif italic text-foreground text-[15px] mb-2">Film a phrase, read it back.</p>
      <p>Upload or record a short clip of one dancer. The tracker runs in your browser (nothing is uploaded), spells every limb as a direction on the sphere, and snaps it to the grid. The snapped score is the truth; the raw track is the evidence.</p>
    </div>
  );
}

const emptySubscribe = () => () => {};

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Render the icon only after hydration; the server doesn't know the theme.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button className="btn px-2" aria-label="toggle light/dark" title="light / dark" onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
