"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import { ArrowLeft, Box, Check, CircleHelp, Download, Film, Grid2X2, Moon, Plus, ScanLine, SlidersHorizontal, Sun, X, PersonStanding, Users, List, Activity, Eye, Layers } from "lucide-react";
import Dialog from "./Dialog";
import NewScore from "./NewScore";
import SaveScore from "./SaveScore";
import Welcome from "./Welcome";
import { createDemo, type DemoPhrase } from "@/lib/demo";
import { DEFAULT_AVATAR_URL } from "@/lib/avatars";
import CastPanel, { type CastMember } from "./Cast";
import type { StageCastMember } from "./Stage";
import { idbGet, idbSet } from "@/lib/store";
import VideoPane from "./VideoPane";
import Timeline from "./Timeline";
import BoneTable from "./BoneTable";
import Controls, { Toggle } from "./Controls";
import Objects, { DEFAULT_OBJECTS, Drawing, type ObjectsOptions } from "./Objects";
import { DEFAULT_GRID, type GridConfig } from "@/lib/grid";
import { DEFAULT_SMOOTH, type LiftMode, type Score, type SmoothConfig, type SourceInfo, frameAt, measureBody, parseScore, rawPoses, serializeScore, smoothPoses, snapPoses } from "@/lib/score";
import { fillGaps, trackVideo, type TrackedFrame } from "@/lib/tracker";
import type { BoneId } from "@/lib/skeleton";
import type { Body } from "@/lib/fk";
import type { Pose } from "@/lib/pose";

type Phase = "idle" | "loading" | "tracking" | "ready" | "error";
const SAMPLE_FPS = 30;
const LS_KEY = "vid2grid:last-score";
const CAST_KEY = "vid2grid:cast";
const Stage = dynamic(() => import("./Stage"), {
  ssr: false,
  loading: () => <div role="status" className="grid h-full place-items-center text-xs text-white/60">Preparing the stage…</div>,
});

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
  const [modal, setModal] = useState<"new" | "settings" | "save" | "details" | "help" | "compare" | null>(null);
  const [newMode, setNewMode] = useState<"upload" | "import">("upload");
  const [settingsTab, setSettingsTab] = useState<"dancer" | "grid" | "cast" | "traces">("dancer");
  const [toast, setToast] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [imported, setImported] = useState<Score | null>(null);
  const [grid, setGrid] = useState<GridConfig>(DEFAULT_GRID);
  const [smooth, setSmooth] = useState<SmoothConfig>(DEFAULT_SMOOTH);
  const [lift, setLift] = useState<LiftMode>("anchored");

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [home, setHome] = useState(true);
  const timeRef = useRef(0);
  const [selected, setSelected] = useState<BoneId | null>(null);
  const [showRaw, setShowRaw] = useState(true);
  const [avatar, setAvatar] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(DEFAULT_AVATAR_URL);
  const [avatarName, setAvatarName] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [view, setView] = useState<"score" | "duet" | "objects">("score");
  const [objects, setObjects] = useState<ObjectsOptions>(DEFAULT_OBJECTS);
  const [cast, setCast] = useState<CastMember[]>([]);
  const previousRef = useRef<{ analysis: Analysis | null; imported: Score | null; src: string | null; time: number; home: boolean } | null>(null);

  const openModal = (name: NonNullable<typeof modal>) => { setPlaying(false); setError(null); setModal(name); };
  const openNew = (mode: "upload" | "import" = "upload") => { setNewMode(mode); openModal("new"); };
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 5000); return () => clearTimeout(id); }, [toast]);

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
    const id = setTimeout(() => { setImported(restored); setGrid(restored.grid); setSmooth(restored.smooth); setLift(restored.lift); setPhase("ready"); }, 0);
    return () => clearTimeout(id);
  }, []);

  /* ---------- derive the score ---------- */

  const extractions = useMemo(() => (analysis ? fillGaps(analysis.tracked, analysis.source.fps) : null), [analysis]);
  const overlays = useMemo(() => analysis?.tracked.map((frame) => frame.image) ?? null, [analysis]);
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
    const id = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, serializeScore(score)); } catch { /* quota */ }
    }, 500);
    return () => clearTimeout(id);
  }, [score]);

  const fi = score ? frameAt(score, time) : 0;
  const snappedPose = score?.frames[fi] ?? null;
  const rawPose = score?.raw[fi] ?? null;
  const overlay = analysis?.tracked[fi]?.image ?? null;

  /* ---------- the cast: dancers pinned onto the shared stage ---------- */

  // Restore, like the score: deferred, best-effort. Scores are megabytes,
  // so the cast lives in IndexedDB, not localStorage.
  const castLoaded = useRef(false);
  useEffect(() => {
    let alive = true;
    idbGet<CastMember[]>(CAST_KEY).then((members) => {
      if (!alive) return;
      castLoaded.current = true;
      const ok = (Array.isArray(members) ? members : []).filter((m) => {
        try { return m && typeof m.id === "string" && typeof m.name === "string" &&
          [m.x, m.z, m.rot].every(Number.isFinite) && !!parseScore(JSON.stringify(m.score)); } catch { return false; }
      });
      if (ok.length) setCast(ok);
    }).catch(() => { castLoaded.current = true; });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!castLoaded.current) return; // don't clobber the stored cast before it's read
    const id = setTimeout(() => {
      idbSet(CAST_KEY, cast.map((m) => ({
        ...m,
        // A session-only blob avatar can't be restored; fall back to the sample.
        avatarUrl: m.avatarUrl?.startsWith("blob:") ? DEFAULT_AVATAR_URL : m.avatarUrl,
      }))).catch(() => { /* the stage still works, it just won't survive reload */ });
    }, 500); // debounce slider drags
    return () => clearTimeout(id);
  }, [cast]);

  const addToCast = useCallback(() => {
    if (!score) return;
    setCast((c) => {
      // Alternate new dancers left/right of centre so they don't stack.
      const slot = c.length + 1;
      const x = Math.ceil(slot / 2) * 0.9 * (slot % 2 ? 1 : -1);
      return [...c, {
        id: crypto.randomUUID(),
        name: score.source.name.replace(/\.[^.]+$/, ""),
        score,
        avatarUrl: avatar ? avatarUrl : null,
        x, z: 0, rot: 0,
      }];
    });
  }, [score, avatar, avatarUrl]);
  const duplicateCast = useCallback((id: string) => {
    setCast((c) => {
      const m = c.find((d) => d.id === id);
      return m ? [...c, { ...m, id: crypto.randomUUID(), x: m.x + 0.9 }] : c;
    });
  }, []);
  const removeCast = useCallback((id: string) => setCast((c) => c.filter((d) => d.id !== id)), []);
  const updateCast = useCallback((id: string, patch: Partial<Pick<CastMember, "x" | "z" | "rot">>) => {
    setCast((c) => c.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  // The stage clock runs to the longest dancer; shorter ones hold their last pose.
  const stageDuration = useMemo(
    () => Math.max(score?.source.duration ?? 0, ...cast.map((m) => m.score.source.duration)),
    [score, cast],
  );
  const stageCast: StageCastMember[] = useMemo(() => cast.map((m) => {
    const p = m.score.frames[frameAt(m.score, time)];
    // Bake the floor placement into the pose: yaw the facing, turn+shift the root.
    const rad = (m.rot * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const pose = { ...p, facing: p.facing + m.rot, x: p.x * cos + p.z * sin + m.x, z: p.z * cos - p.x * sin + m.z };
    return { id: m.id, pose, body: m.score.body, avatarUrl: m.avatarUrl };
  }), [cast, time]);

  /* ---------- getting a clip in ---------- */

  const onFile = useCallback((file: File) => {
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v|ogv)$/i.test(file.name)) {
      setError("Choose a video file, such as MP4, MOV, or WebM.");
      return;
    }
    if (file.size > 250 * 1024 * 1024) {
      setError("This video is too large. Choose a clip smaller than 250 MB.");
      return;
    }
    abortRef.current?.abort();
    if (!previousRef.current) previousRef.current = { analysis, imported, src, time: timeRef.current, home };
    if (src && src !== previousRef.current.src) URL.revokeObjectURL(src);
    setAnalysis(null);
    setImported(null);
    setPlaying(false);
    setTime(0);
    timeRef.current = 0;
    setHome(false);
    setError(null);
    setPhase("loading");
    setModal("new");
    fileNameRef.current = file.name;
    setSrc(URL.createObjectURL(file));
  }, [src, analysis, imported, home]);
  const fileNameRef = useRef("clip");

  const onLoaded = useCallback(async (video: HTMLVideoElement) => {
    setVideoEl(video);
    // Returning from the home screen remounts the video; keep the existing analysis.
    if (analysis) { video.currentTime = Math.min(timeRef.current, video.duration); return; }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // MediaRecorder webm files often report Infinity; force the duration to resolve.
      if (!isFinite(video.duration)) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { clearTimeout(timeout); video.removeEventListener("durationchange", done); ac.signal.removeEventListener("abort", aborted); };
          const done = () => { if (Number.isFinite(video.duration)) { cleanup(); resolve(); } };
          const aborted = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
          const timeout = setTimeout(() => { cleanup(); reject(new Error("Could not read this clip’s duration. Try exporting it as MP4.")); }, 10000);
          video.addEventListener("durationchange", done);
          ac.signal.addEventListener("abort", aborted, { once: true });
          video.currentTime = 1e101;
        });
        video.currentTime = 0;
      }
      if (ac.signal.aborted) return;
      if (!Number.isFinite(video.duration) || video.duration < 1 || video.duration > 120) {
        throw new Error("Choose a clip between 1 and 120 seconds. A 5–30 second phrase works best.");
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
      setAnalysis({
        tracked,
        source: { name: fileNameRef.current, duration: video.duration, fps, width: video.videoWidth, height: video.videoHeight },
      });
      video.currentTime = 0;
      setTime(0);
      setPhase("ready");
      if (previousRef.current?.src) URL.revokeObjectURL(previousRef.current.src);
      previousRef.current = null;
      setModal(null); setView("score"); setToast("Your score is ready. Press Play to explore the movement.");
    } catch (e) {
      if (ac.signal.aborted) return; // superseded by a newer clip
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [analysis]);

  /* ---------- playback ---------- */

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    const d = stageDuration || v?.duration || 0;
    const tt = Math.max(0, Math.min(d, t));
    setTime(tt);
    timeRef.current = tt;
    setPlaying(false);
    if (v && analysis) v.currentTime = Math.min(tt, v.duration);
  }, [stageDuration, analysis]);

  const togglePlay = useCallback(() => { if (score) setPlaying((p) => !p); }, [score]);

  // A clock drives the stage (the cast may outlast the current clip); the
  // video plays alongside while it has frames left, then pauses.
  useEffect(() => {
    if (!playing || !score) return;
    const v = videoRef.current;
    const hasVideo = !!(v && analysis);
    let raf = 0;
    let t0 = performance.now();
    let start = timeRef.current >= stageDuration - 1e-3 ? 0 : timeRef.current;
    if (hasVideo) {
      v.currentTime = Math.min(start, Math.max(0, v.duration - 0.01));
      v.playbackRate = speed;
      if (start < v.duration - 0.02) v.play().catch(() => {});
    }
    let lastFrame = -1;
    const tick = () => {
      let t = start + (performance.now() - t0) / 1000 * speed;
      if (t >= stageDuration - 1e-3) {
        if (!loop) { timeRef.current = stageDuration; setTime(stageDuration); setPlaying(false); return; }
        t = t % stageDuration; start = t; t0 = performance.now();
        if (hasVideo) { v.currentTime = Math.min(t, v.duration); if (t < v.duration) v.play().catch(() => {}); }
      }
      if (hasVideo && !v.paused && (v.ended || v.currentTime >= v.duration - 0.02)) v.pause();
      const f = Math.floor(t * SAMPLE_FPS);
      if (f !== lastFrame) { lastFrame = f; timeRef.current = t; setTime(t); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); if (hasVideo) v.pause(); };
  }, [playing, score, analysis, stageDuration, speed, loop]);

  const step = useCallback((n: number) => {
    if (!score) return;
    setPlaying(false);
    seek((frameAt(score, time) + n) / score.source.fps);
  }, [score, time, seek]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (home || modal || (e.target as HTMLElement)?.closest("input, select, textarea, button, a, [contenteditable=true], [role=slider]")) return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); step(e.shiftKey ? -10 : -1); }
      else if (e.code === "ArrowRight") { e.preventDefault(); step(e.shiftKey ? 10 : 1); }
      else if (e.code === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, step, home, modal]);

  /* ---------- export / import ---------- */

  const exportJson = (name: string) => {
    if (!score) return;
    const blob = new Blob([serializeScore(score)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[\\/:*?"<>|]/g, "-")}.vid2grid.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setModal(null); setToast("Score download started. Reopen it from New score → Open score.");
  };
  const importJson = (file: File) => {
    if (file.size > 25 * 1024 * 1024) { setError("Choose a score smaller than 25 MB."); return; }
    file.text().then((t) => {
      const sc = parseScore(t);
      abortRef.current?.abort();
      if (previousRef.current?.src && previousRef.current.src !== src) URL.revokeObjectURL(previousRef.current.src);
      previousRef.current = null;
      if (src) URL.revokeObjectURL(src);
      setSrc(null); setAnalysis(null); setImported(sc); setGrid(sc.grid); setSmooth(sc.smooth); setLift(sc.lift); setHome(false); timeRef.current = 0;
      setTime(0); setPlaying(false); setPhase("ready"); setError(null); setModal(null); setToast("Score opened. Press Play to explore it.");
      setView((v) => (v === "duet" ? "score" : v)); // duet needs a video
    }).catch((e) => { setError(e instanceof Error ? e.message : "Could not import this score."); });
  };

  const loadDemo = (phrase: DemoPhrase, avatarPresetUrl?: string) => {
    abortRef.current?.abort();
    if (previousRef.current?.src && previousRef.current.src !== src) URL.revokeObjectURL(previousRef.current.src);
    previousRef.current = null;
    if (src) URL.revokeObjectURL(src);
    const sc = createDemo(phrase);
    setSrc(null); setAnalysis(null); setImported(sc); setGrid(sc.grid); setSmooth(sc.smooth); setLift(sc.lift);
    if (avatarPresetUrl) onAvatarPreset(avatarPresetUrl);
    timeRef.current = 0; setTime(0); setPlaying(false); setHome(false); setPhase("ready"); setError(null); setView("score"); setSelected(null); setModal(null);
    setToast(avatarPresetUrl ? "Your character is on stage. Press Play to see them move." : "Example ready. Press Play, then try Settings to make it your own.");
  };

  const cancelTracking = () => {
    abortRef.current?.abort();
    if (src) URL.revokeObjectURL(src);
    const previous = previousRef.current;
    setSrc(previous?.src ?? null); setAnalysis(previous?.analysis ?? null); setImported(previous?.imported ?? null);
    timeRef.current = previous?.time ?? 0; setTime(timeRef.current);
    setPhase(previous?.analysis || previous?.imported ? "ready" : "idle");
    setHome(previous?.home ?? true); setError(null); setModal(null); previousRef.current = null;
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

  const welcome = home || (!score && !busy && !src);
  const closeNew = () => { if (previousRef.current) cancelTracking(); else { setModal(null); setError(null); } };
  return (
    <div className={`app-shell flow-shell ${welcome ? "is-welcome" : "is-studio"}`}>
      <header className="app-header">
        <button className="brand-lockup" disabled={busy} onClick={() => { setHome(true); setPlaying(false); }} aria-label="vid2grid home">
          <span className="brand-mark"><Grid2X2 size={21} strokeWidth={1.7} /></span>
          <span className="brand-name">vid<span>2</span>grid</span>
          <span className="brand-descriptor">MOVEMENT<br />LANGUAGES</span>
        </button>
        <div className="header-actions">
          <button className="btn" onClick={() => openModal("help")}><CircleHelp size={17} /><span className="help-label">Help</span></button>
          {welcome ? <button className="btn" onClick={() => openNew("import")}>Open score</button> : <>
            <button className="btn" onClick={() => openNew()} disabled={busy}><Plus size={17} />New score</button>
            <button className="btn primary" onClick={() => openModal("save")} disabled={!score}><Download size={17} />Save</button>
          </>}
        </div>
      </header>

      {welcome && <>{score && <div className="resume-bar"><button className="resume-card" onClick={() => setHome(false)}><ArrowLeft size={20} /><span><strong>Continue your last score</strong><small>{score.source.name}</small></span><span>Open studio</span></button></div>}<Welcome onStart={() => openNew()} onDemo={loadDemo} /></>}
      {!welcome && <>
        <div className="project-bar"><div><button className="text-action" onClick={() => { setHome(true); setPlaying(false); }} disabled={busy}><ArrowLeft size={16} />Home</button><span className="project-name">{source?.name ?? "Creating your score"}</span></div><span className="project-type">{source?.name.endsWith("· example") ? "EXAMPLE STUDY" : "MOVEMENT SCORE"}</span></div>
        <div className="studio-toolbar">
          <nav className="seg view-tabs" aria-label="Choose a view">
            <button aria-pressed={view === "score"} onClick={() => setView("score")}><Box size={18} />3D stage</button>
            <button aria-pressed={view === "duet"} onClick={() => src ? setView("duet") : openModal("compare")}><Film size={18} />Compare</button>
            <button aria-pressed={view === "objects"} onClick={() => setView("objects")}><ScanLine size={18} />Traces</button>
          </nav>
          <div className="studio-tools"><button className="btn" disabled={!score} onClick={() => openModal("details")}><List size={17} />Notation</button><button className="btn" disabled={!score} onClick={() => { setSettingsTab(view === "objects" ? "traces" : "dancer"); openModal("settings"); }}><SlidersHorizontal size={17} />Settings</button></div>
        </div>
        <main className={`studio-workspace focused-workspace ${view === "duet" ? "compare-workspace" : ""}`}>
          <section className={`source-panel ${view === "duet" ? "" : "source-hidden"}`} aria-label="Original video">
            <div className="panel-heading"><span><Film size={16} />Original video</span></div>
            <div className="source-video"><VideoPane ref={videoRef} src={src} overlay={overlay} showOverlay={showOverlay} onLoaded={onLoaded} onError={() => { abortRef.current?.abort(); setError("This video could not be decoded. Try an MP4 or WebM clip."); setPhase("error"); setModal("new"); }} /></div>
          </section>
          <section className="stage-panel" aria-label={view === "objects" ? "Movement traces" : "3D movement stage"}>
            <div className="stage-heading"><span><span className="status-dot" />{view === "objects" ? "The path of your movement" : "Your movement, in 3D"}</span><span className="mono">{grid.azStep}° GRID</span></div>
            {view === "objects" && score ? <Objects score={score} overlays={overlays} video={analysis ? videoEl : null} frame={fi} options={objects} /> :
              (score && body) || stageCast.length ? <Stage pose={snappedPose} raw={rawPose} body={body} grid={grid} showRaw={showRaw} avatar={avatar} avatarUrl={avatarUrl} cast={stageCast} selected={selected} onSelect={setSelected} /> :
              <div className="stage-empty"><Activity size={35} /><span>Your movement will appear here.</span></div>}
            {view !== "objects" && <div className="stage-legend"><span><i className="bg-limb-l" />Left side</span><span><i className="bg-limb-r" />Right side</span><span className="stage-help">Drag to rotate · Pinch or scroll to zoom</span></div>}
            {selected && view !== "objects" && <button className="selected-limb" onClick={() => setSelected(null)}>{selected} · selected <X size={15} /></button>}
          </section>
        </main>
        {score && <footer className="studio-timeline"><Timeline score={score} total={stageDuration} time={time} playing={playing} onSeek={seek} onTogglePlay={togglePlay} onStep={step} selected={selected} onSelect={setSelected} speed={speed} onSpeed={setSpeed} loop={loop} onLoop={() => setLoop((l) => !l)} /></footer>}
      </>}

      <Dialog open={modal === "new"} title={busy ? "Creating your score" : "Start a new score"} description={busy ? "Your video is being processed on this device." : "A video, a recording, or a saved score. Choose where to begin."} onClose={closeNew} locked={busy}>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <NewScore initialMode={newMode} onFile={onFile} onImport={importJson} onDemo={loadDemo} busy={busy} progress={progress} loading={phase === "loading"} onCancel={cancelTracking} />
      </Dialog>
      <Dialog open={modal === "save"} title="Save your movement" description="Download a reusable copy of the current dancer’s score." onClose={() => setModal(null)}>
        {score && <SaveScore key={score.source.name} score={score} onSave={exportJson} />}
      </Dialog>
      <Dialog open={modal === "settings"} title="Studio settings" description="Changes apply immediately. Close this panel to see them on the stage." onClose={() => setModal(null)}>
        <div className="dialog-tabs settings-tabs" aria-label="Settings section">
          <button aria-pressed={settingsTab === "dancer"} onClick={() => setSettingsTab("dancer")}><PersonStanding size={19} />Dancer</button>
          <button aria-pressed={settingsTab === "grid"} onClick={() => setSettingsTab("grid")}><Grid2X2 size={19} />Movement grid</button>
          <button aria-pressed={settingsTab === "cast"} onClick={() => setSettingsTab("cast")}><Users size={19} />Cast{cast.length ? ` (${cast.length})` : ""}</button>
          {view === "objects" && <button aria-pressed={settingsTab === "traces"} onClick={() => setSettingsTab("traces")}><ScanLine size={19} />Traces</button>}
        </div>
        {(settingsTab === "dancer" || settingsTab === "grid") && <Controls panel={settingsTab} grid={grid} smooth={smooth} onGrid={setGrid} onSmooth={setSmooth} lift={lift} onLift={setLift} canLift={!!analysis} showRaw={showRaw} onShowRaw={setShowRaw} avatar={avatar} onAvatar={setAvatar} avatarUrl={avatarUrl} avatarName={avatarName} onAvatarFile={onAvatarFile} onAvatarPreset={onAvatarPreset} showOverlay={showOverlay} onShowOverlay={setShowOverlay} />}
        {settingsTab === "cast" && <div className="settings-content"><div className="setting-heading"><Users size={23} /><div><h3>Build a group piece</h3><p>Add a copy of this dancer, then place it on the stage. Each cast member keeps its own movement.</p></div></div><CastPanel cast={cast} canAdd={!!score} onAdd={() => { addToCast(); setToast("Dancer added to your cast."); }} onDuplicate={duplicateCast} onRemove={removeCast} onUpdate={updateCast} /></div>}
        {settingsTab === "traces" && score && <div className="settings-content">
          <Toggle icon={<Activity size={21} />} title="Movement trails" detail="Follow the hands, feet, and head through space." checked={objects.traces} onChange={(traces) => setObjects({ ...objects, traces })} />
          <label className="setting-slider"><span><strong>Trail length</strong><output>{objects.trailSeconds.toFixed(1)} seconds</output></span><input type="range" min={0.2} max={6} step={0.1} value={objects.trailSeconds} onChange={(e) => setObjects({ ...objects, trailSeconds: +e.target.value })} /></label>
          <Toggle icon={<Layers size={21} />} title="Body alignments" detail="Highlight parallel and aligned limbs." checked={objects.alignments} onChange={(alignments) => setObjects({ ...objects, alignments })} />
          <Toggle icon={<ScanLine size={21} />} title="Movement density" detail="Reveal the areas where movement gathers." checked={objects.density} onChange={(density) => setObjects({ ...objects, density })} />
          <Toggle icon={<Eye size={21} />} title="Original video" detail={analysis ? "Show the recording behind the traces." : "Available when you add a video."} checked={objects.video} disabled={!analysis} onChange={(video) => setObjects({ ...objects, video })} />
          <div className="setting-heading"><ScanLine size={22} /><div><h3>The whole phrase, drawn</h3><p>Every trace from the clip in a single drawing.</p></div></div><div className="aspect-video card overflow-hidden"><Drawing score={score} overlays={overlays} /></div>
        </div>}
        <div className="dialog-footer"><span><Check size={15} /> Changes applied</span><button className="btn primary" onClick={() => setModal(null)}>Done</button></div>
      </Dialog>
      <Dialog open={modal === "details"} title="Read the movement" description="Directions for the current frame. Select a limb to highlight it on the stage." onClose={() => setModal(null)} wide>
        {snappedPose && rawPose && <><div className="notation-scroll"><BoneTable snapped={snappedPose} raw={rawPose} selected={selected} onSelect={(id) => { setSelected(id); setModal(null); setView("score"); }} /></div><p className="dialog-note">Grid: snapped angles. Laban: direction and level. E-W: Eshkol–Wachman units. Raw: the tracked angles before snapping.</p></>}
      </Dialog>
      <Dialog open={modal === "compare"} title="Compare needs a video" description="This score contains movement data, but no original recording." onClose={() => setModal(null)}>
        <div className="empty-dialog"><Film size={35} /><p>Create a score from your own video to watch the recording and 3D dancer together.</p><button className="btn primary" onClick={() => openNew()}>Choose a video</button><button className="btn" onClick={() => setModal(null)}>Back to the stage</button></div>
      </Dialog>
      <Dialog open={modal === "help"} title="A quick tour" description="From a video to a movement you can explore." onClose={() => setModal(null)}>
        <div className="help-steps"><div><Film size={23} /><span><strong>1. Create a score</strong><p>Choose or record a short video. Preview it, then tap Create movement score. Or open an example to try things out.</p></span></div><div><Box size={23} /><span><strong>2. Explore the phrase</strong><p>Press Play. Drag the dancer to rotate the view. Compare shows your source video; Traces reveals movement paths.</p></span></div><div><SlidersHorizontal size={23} /><span><strong>3. Make it yours</strong><p>Settings changes the dancer, movement detail, and cast. Notation explains the selected frame. Save downloads the current dancer’s score.</p></span></div></div>
        <div className="help-shortcuts"><span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd><kbd>→</kbd> Step frames</span></div>
        <div className="dialog-footer"><span>Appearance</span><ThemeToggle /></div><button className="btn primary dialog-primary" onClick={() => setModal(null)}>Got it</button>
      </Dialog>
      {toast && <div className="studio-toast" role="status"><Check size={18} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16} /></button></div>}
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
