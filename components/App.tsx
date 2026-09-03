"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Source from "./Source";
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
  const [showOverlay, setShowOverlay] = useState(true);
  const [view, setView] = useState<"score" | "objects">("score");
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
    }).catch((e) => { setError(String(e)); setPhase("error"); });
  };

  const busy = phase === "loading" || phase === "tracking";

  /* ---------- layout ---------- */

  return (
    <div className="flex flex-col h-dvh">
      <header className="flex items-center gap-3 px-4 h-11 border-b border-line text-sm shrink-0">
        <span className="font-semibold tracking-tight">vid2grid</span>
        <span className="text-muted text-xs hidden sm:inline">video → grid-snapped 3D score</span>
        <div className="ml-4 inline-flex rounded border border-line overflow-hidden text-xs">
          <button className={`px-3 py-0.5 ${view === "score" ? "bg-accent text-black" : "hover:bg-panel-2"}`} onClick={() => setView("score")}>score</button>
          <button className={`px-3 py-0.5 ${view === "objects" ? "bg-accent text-black" : "hover:bg-panel-2"}`} onClick={() => setView("objects")}>objects</button>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <button className="btn" onClick={() => setShowSource((s) => !s)}>{showSource ? "hide source" : "new clip"}</button>
          <label className="btn cursor-pointer">import JSON<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.currentTarget.value = ""; }} /></label>
          <button className="btn" onClick={exportJson} disabled={!score}>export JSON</button>
        </div>
      </header>

      {showSource && (
        <div className="px-4 py-3 border-b border-line max-w-3xl w-full mx-auto">
          <Source onFile={onFile} busy={busy} />
        </div>
      )}

      {phase === "error" && (
        <div className="mx-4 mt-3 rounded border border-right/50 bg-right/10 px-3 py-2 text-xs">{error}</div>
      )}

      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(280px,1fr)_2fr_minmax(260px,0.9fr)] grid-rows-[auto_1fr] lg:grid-rows-1 gap-px bg-line">
        {/* left: video + readouts */}
        <section className="bg-bg flex flex-col min-h-0">
          <div className="relative aspect-video lg:aspect-auto lg:h-[38%] shrink-0 bg-black">
            <VideoPane ref={videoRef} src={src} overlay={overlay} showOverlay={showOverlay} onLoaded={onLoaded} />
            {busy && (
              <div className="absolute inset-0 grid place-items-center bg-black/60">
                <div className="text-center text-xs">
                  <div className="mb-2">{phase === "loading" ? "loading clip…" : `tracking ${progress.done}/${progress.total}`}</div>
                  <div className="w-48 h-1.5 bg-panel-2 rounded overflow-hidden">
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {snappedPose && rawPose ? (
              <BoneTable snapped={snappedPose} raw={rawPose} selected={selected} onSelect={setSelected} />
            ) : (
              <Empty />
            )}
          </div>
        </section>

        {/* centre: the stage, or the annotated video */}
        <section className="bg-bg min-h-[320px] lg:min-h-0 relative">
          {score && body ? (
            view === "score" ? (
              <Stage pose={snappedPose} raw={rawPose} body={body} grid={grid} showRaw={showRaw} avatar={avatar} selected={selected} onSelect={setSelected} />
            ) : (
              <Objects score={score} overlays={analysis ? analysis.tracked.map((t) => t.image) : null} video={analysis ? videoEl : null} frame={fi} options={objects} />
            )
          ) : (
            <div className="w-full h-full grid place-items-center text-muted text-sm">the stage</div>
          )}
          {selected && view === "score" && (
            <div className="absolute top-2 left-2 text-[11px] text-accent bg-black/50 rounded px-2 py-1 mono">
              {selected} · yellow = snapped cell · white = raw
            </div>
          )}
        </section>

        {/* right: controls */}
        <section className="bg-bg flex flex-col min-h-0 overflow-auto">
          {view === "objects" && score ? (
            <>
              <div className="px-3 pt-3 text-xs text-muted">synchronous objects</div>
              <div className="text-xs flex flex-col gap-2 p-3">
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={objects.traces} onChange={(e) => setObjects({ ...objects, traces: e.target.checked })} /> traces of hands, feet, head</label>
                <label className="grid grid-cols-[7.5rem_1fr] items-center gap-2"><span className="text-muted mono">trail {objects.trailSeconds.toFixed(1)} s</span><input type="range" min={0.2} max={6} step={0.1} value={objects.trailSeconds} onChange={(e) => setObjects({ ...objects, trailSeconds: +e.target.value })} /></label>
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={objects.alignments} onChange={(e) => setObjects({ ...objects, alignments: e.target.checked })} /> alignments (∥ parallel · ═ collinear)</label>
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={objects.density} onChange={(e) => setObjects({ ...objects, density: e.target.checked })} /> movement density</label>
                <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={objects.video} onChange={(e) => setObjects({ ...objects, video: e.target.checked })} /> show video plate</label>
              </div>
              <div className="px-3 text-xs text-muted">generative drawing — the whole clip&apos;s traces, weight by speed</div>
              <div className="m-3 aspect-video rounded overflow-hidden border border-line"><Drawing score={score} overlays={analysis ? analysis.tracked.map((t) => t.image) : null} /></div>
              <div className="px-3 pb-3 text-[11px] text-muted leading-relaxed">After Forsythe/OSU&apos;s <em>Synchronous Objects</em> (2009): the dance as data — traces, alignments, density, drawing.</div>
            </>
          ) : (<>
          <div className="px-3 pt-3 text-xs text-muted">the grid</div>
          <Controls grid={grid} smooth={smooth} onGrid={setGrid} onSmooth={setSmooth} lift={lift} onLift={setLift} canLift={!!analysis} showRaw={showRaw} onShowRaw={setShowRaw} avatar={avatar} onAvatar={setAvatar} showOverlay={showOverlay} onShowOverlay={setShowOverlay} />
          {score && (
            <div className="px-3 pb-3 text-[11px] text-muted leading-relaxed">
              <div className="mono">{score.source.name}</div>
              <div>{score.frames.length} frames @ {score.source.fps} fps · {score.keyframes.length} keyframes · body {(score.body.lengths.torso + score.body.lengths.rthigh + score.body.lengths.rshin).toFixed(2)} m torso+leg</div>
              <div className="mt-2">Click a limb (or a row) to see its grid sphere. Space plays; ←/→ step frames.</div>
            </div>
          )}
          </>)}
        </section>
      </main>

      {score && (
        <footer className="border-t border-line px-4 py-2 shrink-0">
          <Timeline score={score} time={time} playing={playing} onSeek={seek} onTogglePlay={togglePlay} onStep={step} selected={selected} onSelect={setSelected} />
        </footer>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="p-4 text-xs text-muted leading-relaxed">
      <p>Upload or record a short clip of one dancer. The tracker runs in your browser (nothing is uploaded), spells every limb as a direction on the sphere, and snaps it to the grid. The snapped score is the truth; the raw track is the evidence.</p>
    </div>
  );
}
