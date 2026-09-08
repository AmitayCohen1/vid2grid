"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import { ArrowLeft, Box, Check, CircleHelp, Download, Film, Grid2X2, Moon, PanelRightClose, Plus, ScanLine, SlidersHorizontal, Sun, X, PersonStanding, Users, List, Activity } from "lucide-react";
import Dialog from "./Dialog";
import NewScore from "./NewScore";
import SaveScore from "./SaveScore";
import Welcome from "./Welcome";
import { createDemo, type DemoPhrase } from "@/lib/demo";
import { DEFAULT_AVATAR_URL } from "@/lib/avatars";
import CastPanel, { type CastMember, type CastPatch } from "./Cast";
import type { StageCastMember } from "./Stage";
import { NO_DEVICES, clipTime, memberSpan, mirrorBody, mirrorPose, placePose, sanitizeDevices, scaleBody, scalePose } from "@/lib/devices";
import { imageToWorld, videoAnchors } from "@/lib/invideo";
import { idbGet, idbSet } from "@/lib/store";
import VideoPane from "./VideoPane";
import Timeline from "./Timeline";
import LiveBar from "./LiveBar";
import BoneTable from "./BoneTable";
import Controls from "./Controls";
import { NumSlider, Section, Switch } from "./Inspector";
import Objects, { DEFAULT_OBJECTS, Drawing, type ObjectsOptions } from "./Objects";
import { DEFAULT_GRID, type GridConfig } from "@/lib/grid";
import { DEFAULT_SMOOTH, type LiftMode, type Score, type SmoothConfig, type SourceInfo, frameAt, measureBody, parseScore, rawPoses, serializeScore, smoothPoses, snapPoses } from "@/lib/score";
import { fillGaps, trackVideo, type TrackedFrame } from "@/lib/tracker";
import { LiveCapture } from "@/lib/capture";
import { type LiveFrame, LiveScore, resampleLive } from "@/lib/live";
import { type Crop, cropPixels, isFullCrop } from "@/lib/crop";
import type { PersonPick } from "@/lib/follow";
import { describeError } from "@/lib/errors";
import { estimateTempo } from "@/lib/tempo";
import type { BoneId } from "@/lib/skeleton";
import type { Body } from "@/lib/fk";
import type { Pose } from "@/lib/pose";

const RAIL = [
  { id: "dancer" as const, label: "Dancer", short: "Dancer", icon: <PersonStanding size={15} /> },
  { id: "grid" as const, label: "Movement grid", short: "Grid", icon: <Grid2X2 size={15} /> },
  { id: "cast" as const, label: "Cast", short: "Cast", icon: <Users size={15} /> },
  { id: "traces" as const, label: "Traces", short: "Traces", icon: <ScanLine size={15} /> },
];

type Phase = "idle" | "loading" | "tracking" | "live" | "ready" | "error";
const SAMPLE_FPS = 30;
const LS_KEY = "vid2grid:last-score";
const CAST_KEY = "vid2grid:cast";
const Stage = dynamic(() => import("./Stage"), {
  ssr: false,
  loading: () => <div role="status" className="grid h-full place-items-center text-xs text-white/60">Preparing the stage…</div>,
});
const VideoStage = dynamic(() => import("./VideoStage"), { ssr: false });

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
  const [modal, setModal] = useState<"new" | "save" | "details" | "help" | "compare" | null>(null);
  const [newMode, setNewMode] = useState<"upload" | "import" | "live">("upload");
  const [settingsTab, setSettingsTab] = useState<"dancer" | "grid" | "cast" | "traces">("dancer");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [motion, setMotion] = useState<"stepped" | "smooth">("stepped");
  const [toast, setToast] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  /** Region of the clip being tracked, chosen in the preview; the analysis records its own once done. */
  const [pendingCrop, setPendingCrop] = useState<Crop | null>(null);
  const [pendingFollow, setPendingFollow] = useState<PersonPick | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [imported, setImported] = useState<Score | null>(null);
  const [grid, setGrid] = useState<GridConfig>(DEFAULT_GRID);
  const [smooth, setSmooth] = useState<SmoothConfig>(DEFAULT_SMOOTH);
  const [lift, setLift] = useState<LiftMode>("anchored");

  /* A live take: the camera is the source and the score forms as the dancer moves. */
  const [live, setLive] = useState<{ capture: LiveCapture; stream: MediaStream } | null>(null);
  const liveRef = useRef<LiveCapture | null>(null);
  const [liveFrame, setLiveFrame] = useState<LiveFrame | null>(null);
  const [liveOverlay, setLiveOverlay] = useState<Float32Array | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [limitHit, setLimitHit] = useState(false);

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
  /** Compare view: draw the character and the cast inside the recording, beside the person. */
  const [inVideo, setInVideo] = useState(true);
  /** Where the character stands in the video, metres to the person's screen-right — tied to the clip it was set for. */
  const [besideOverride, setBesideOverride] = useState<{ source: SourceInfo; beside: number } | null>(null);
  /** Seconds the character in the video runs behind the person — the off-sync ghost, on purpose. */
  const [selfDelay, setSelfDelay] = useState(0);
  /** How big the current dancer is drawn (stage and video); display only, the score keeps the tracked body. */
  const [size, setSize] = useState(1);
  const previousRef = useRef<{ analysis: Analysis | null; imported: Score | null; src: string | null; time: number; home: boolean } | null>(null);

  const openModal = (name: NonNullable<typeof modal>) => { setPlaying(false); setError(null); setModal(name); };
  const openNew = (mode: "upload" | "import" | "live" = "upload") => { setNewMode(mode); openModal("new"); };
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

  /* The pulse is derived like everything else: a new grid re-snaps the
     keyframes, which re-aligns the beat phase, with no re-tracking. */
  const tempo = useMemo(
    () => (score ? estimateTempo(score.raw, score.keyframes.map((i) => score.raw[i].t), score.source.fps) : null),
    [score],
  );
  // A hand-set tempo is tied to the clip it was set for, so a new clip re-estimates.
  const [bpmOverride, setBpmOverride] = useState<{ source: SourceInfo; bpm: number } | null>(null);
  const bpm = (bpmOverride?.source === source ? bpmOverride.bpm : null) ?? tempo?.bpm ?? 100;
  const onBpm = useCallback((n: number) => { if (source) setBpmOverride({ source, bpm: n }); }, [source]);

  useEffect(() => {
    if (!score) return;
    const id = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, serializeScore(score)); } catch { /* quota */ }
    }, 500);
    return () => clearTimeout(id);
  }, [score]);

  const fi = score ? frameAt(score, time) : 0;
  // The current dancer's frame: from the score, or — live — whatever the camera just gave.
  const snappedPose = live ? liveFrame?.snapped ?? null : score?.frames[fi] ?? null;
  const rawPose = live ? liveFrame?.raw ?? null : score?.raw[fi] ?? null;
  const curBody = live ? liveFrame?.body ?? null : body;
  // What the stage draws for the current dancer: the same poses at the chosen size. Notation and exports use the unscaled ones.
  const stageBody = useMemo(() => (curBody ? scaleBody(curBody, size) : null), [curBody, size]);
  const stagePose = useMemo(() => (snappedPose ? scalePose(snappedPose, size) : null), [snappedPose, size]);
  const stageRaw = useMemo(() => (rawPose ? scalePose(rawPose, size) : null), [rawPose, size]);
  const overlay = live ? liveOverlay : analysis?.tracked[fi]?.image ?? null;

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
      }).map((m) => ({ ...m, ...sanitizeDevices(m) })); // casts saved before devices existed
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

  /** The current dancer as a cast member, placed `x` metres across. */
  const member = useCallback((x: number, devices = NO_DEVICES): CastMember | null => score ? {
    id: crypto.randomUUID(),
    name: score.source.name.replace(/\.[^.]+$/, ""),
    score,
    avatarUrl: avatar ? avatarUrl : null,
    x, z: 0, rot: 0,
    ...devices,
    size,
  } : null, [score, avatar, avatarUrl, size]);
  const addToCast = useCallback(() => {
    setCast((c) => {
      // Alternate new dancers left/right of centre so they don't stack —
      // starting on the left, since the character stands to the right in the video.
      const slot = c.length + 1;
      const m = member(Math.ceil(slot / 2) * 1.0 * (slot % 2 ? -1 : 1));
      return m ? [...c, m] : c;
    });
  }, [member]);
  /** A canon: the current dancer again, `voices − 1` times, each entering `gap` seconds after the last, in a line to the left. */
  const addCanon = useCallback((voices: number, gap: number) => {
    setCast((c) => {
      const copies: CastMember[] = [];
      for (let k = 1; k < voices; k++) {
        const m = member(-k * 1.0, { ...NO_DEVICES, delay: Math.round(k * gap * 100) / 100 });
        if (m) copies.push(m);
      }
      return [...c, ...copies];
    });
  }, [member]);
  const duplicateCast = useCallback((id: string) => {
    setCast((c) => {
      const m = c.find((d) => d.id === id);
      return m ? [...c, { ...m, id: crypto.randomUUID(), x: m.x + 0.9 }] : c;
    });
  }, []);
  const removeCast = useCallback((id: string) => setCast((c) => c.filter((d) => d.id !== id)), []);
  const updateCast = useCallback((id: string, patch: CastPatch) => {
    setCast((c) => c.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  // The stage clock runs to the longest dancer (delay and speed included); shorter ones hold their last pose.
  const stageDuration = useMemo(
    () => Math.max((score?.source.duration ?? 0) + (inVideo ? selfDelay : 0), ...cast.map((m) => memberSpan(m.score.source.duration, m))),
    [score, cast, inVideo, selfDelay],
  );
  // Each member at the stage clock, through its devices, with its floor placement baked in.
  // Same track as the live figure (snapped or smooth), or the stage disagrees with itself.
  const stageCast: StageCastMember[] = useMemo(() => cast.map((m) => {
    const track = motion === "smooth" ? m.score.raw : m.score.frames;
    const p = track[frameAt(m.score, clipTime(time, m.score.source.duration, m))];
    const pose = scalePose(placePose(m.mirror ? mirrorPose(p) : p, m), m.size);
    return { id: m.id, pose, body: scaleBody(m.mirror ? mirrorBody(m.score.body) : m.score.body, m.size), avatarUrl: m.avatarUrl };
  }), [cast, time, motion]);

  /* ---------- figures inside the video ---------- */

  // Per frame: where the person is in the picture and how many metres it spans there.
  const anchors = useMemo(() => {
    if (!analysis || !extractions || !overlays || !raw) return null;
    const { width, height } = analysis.source;
    return videoAnchors(overlays, extractions.map((e) => e.metresPerUnit), raw.map((p) => p.hipY), width / height);
  }, [analysis, extractions, overlays, raw]);
  const anchor = anchors?.[fi] ?? null;
  // Until it is set for this clip, the character stands on whichever side of the person has more picture.
  const besideDefault = useMemo(() => {
    if (!anchors?.length) return 1.0;
    const us = anchors.map((a) => a.u).sort((a, b) => a - b);
    return us[us.length >> 1] > 0.5 ? -1.0 : 1.0;
  }, [anchors]);
  const beside = besideOverride?.source === source ? besideOverride.beside : besideDefault;
  const setBeside = useCallback((n: number) => { if (source) setBesideOverride({ source, beside: n }); }, [source]);
  const videoAspect = analysis ? analysis.source.width / analysis.source.height : 16 / 9;
  // Figures in picture metres: the character `beside` the person, the cast at their stage
  // offsets from the person — hips at the person's hips, feet on the person's floor.
  const videoFigures: StageCastMember[] = useMemo(() => {
    if (!inVideo || !anchor || !score || !body) return [];
    const track = motion === "smooth" ? score.raw : score.frames;
    const live = track[fi];
    // The character may run behind the person; its travel stays relative to where the person is now.
    const self = selfDelay > 0 ? track[frameAt(score, clipTime(time, score.source.duration, { ...NO_DEVICES, delay: selfDelay }))] : live;
    const at = imageToWorld(anchor.u, anchor.floorV, anchor.mpu, videoAspect);
    const out: StageCastMember[] = [{ id: "self", pose: { ...self, x: at.x + beside + (self.x - live.x), z: 0, hipY: at.y + self.hipY * size }, body: scaleBody(body, size), avatarUrl: avatar ? avatarUrl : null }];
    for (const m of stageCast) out.push({ ...m, pose: { ...m.pose, x: at.x + (m.pose.x - live.x), z: m.pose.z - live.z, hipY: at.y + m.pose.hipY } });
    return out;
  }, [inVideo, anchor, score, body, size, fi, time, selfDelay, motion, videoAspect, beside, avatar, avatarUrl, stageCast]);

  /* ---------- getting a clip in ---------- */

  const onFile = useCallback((file: File, crop?: Crop, follow?: PersonPick) => {
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
    setPendingCrop(crop && !isFullCrop(crop) ? crop : null);
    setPendingFollow(follow ?? null);
    setSrc(URL.createObjectURL(file));
  }, [src, analysis, imported, home]);
  const fileNameRef = useRef("clip");

  const onLoaded = useCallback(async (video: HTMLVideoElement) => {
    // The camera: start scoring what it shows.
    if (video.srcObject) { liveRef.current?.run(video); return; }
    setVideoEl(video);
    // Returning from the home screen remounts the video; keep the existing analysis.
    // (A finished live take arrives here the same way, with its frames already tracked.)
    if (analysis) {
      if (!isFinite(video.duration)) await resolveDuration(video).catch(() => {});
      video.currentTime = Math.min(timeRef.current, video.duration);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // MediaRecorder webm files often report Infinity; force the duration to resolve.
      if (!isFinite(video.duration)) await resolveDuration(video, ac.signal);
      if (ac.signal.aborted) return;
      if (!Number.isFinite(video.duration) || video.duration < 1 || video.duration > 120) {
        throw new Error("Choose a clip between 1 and 120 seconds. A 5–30 second phrase works best.");
      }
      video.pause();
      setPhase("tracking");
      const fps = SAMPLE_FPS;
      const total = Math.floor(video.duration * fps);
      setProgress({ done: 0, total });
      const crop = pendingCrop ?? undefined;
      const tracked = await trackVideo(video, {
        fps,
        crop,
        follow: pendingFollow ?? undefined,
        signal: ac.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (ac.signal.aborted) return;
      const detected = tracked.filter((f) => f.extraction).length;
      if (!detected) throw new Error(pendingFollow ? "The dancer you chose was never seen clearly. Pick them again on a frame where their whole body is in view." : crop ? "No person detected inside the framed region. Try a wider crop, or Fit to dancer." : "No person detected in this clip. Try a clip with your whole body in frame.");
      const px = crop ? cropPixels(crop, video.videoWidth, video.videoHeight) : { w: video.videoWidth, h: video.videoHeight };
      setAnalysis({
        tracked,
        source: { name: fileNameRef.current, duration: video.duration, fps, width: px.w, height: px.h, crop },
      });
      video.currentTime = 0;
      setTime(0);
      setPhase("ready");
      if (previousRef.current?.src) URL.revokeObjectURL(previousRef.current.src);
      previousRef.current = null;
      setModal(null); setView("score"); setToast("Your score is ready. Press Play to explore the movement.");
    } catch (e) {
      if (ac.signal.aborted) return; // superseded by a newer clip
      setError(describeError(e));
      setPhase("error");
    }
  }, [analysis, pendingCrop, pendingFollow]);

  /* ---------- a live take ---------- */

  const startLive = useCallback(() => {
    abortRef.current?.abort();
    if (!previousRef.current) previousRef.current = { analysis, imported, src, time: timeRef.current, home };
    if (src && src !== previousRef.current.src) URL.revokeObjectURL(src);
    setSrc(null); setAnalysis(null); setImported(null); setVideoEl(null);
    setPlaying(false); setTime(0); timeRef.current = 0;
    setLiveFrame(null); setLiveOverlay(null); setFinishing(false);
    setHome(false); setError(null); setPhase("loading"); setModal("new"); setSelected(null);
    setView((v) => (v === "objects" ? "score" : v));
    const engine = new LiveScore({ grid, smooth, lift });
    const capture: LiveCapture = new LiveCapture({
      engine,
      fps: SAMPLE_FPS,
      onFrame: (frame, image, t) => { setLiveFrame(frame); setLiveOverlay(image); timeRef.current = t; setTime(t); },
      onLimit: () => setLimitHit(true),
      onError: (e) => { capture.cancel(); liveRef.current = null; setLive(null); setError(describeError(e)); setPhase("error"); setModal("new"); },
    });
    liveRef.current = capture;
    capture.open().then((stream) => {
      if (liveRef.current !== capture) { capture.cancel(); return; } // superseded
      setLive({ capture, stream });
      setPhase("live");
      setModal(null);
      setToast("You're live. Move — the score is written as you go.");
    }).catch((e) => {
      if (liveRef.current === capture) liveRef.current = null;
      setError(e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
        ? "The camera was not allowed. Give this page camera access, then try again."
        : describeError(e));
      setPhase("error");
    });
  }, [analysis, imported, src, home, grid, smooth, lift]);

  const restorePrevious = useCallback(() => {
    const previous = previousRef.current;
    setSrc(previous?.src ?? null); setAnalysis(previous?.analysis ?? null); setImported(previous?.imported ?? null); setPendingCrop(null);
    timeRef.current = previous?.time ?? 0; setTime(timeRef.current);
    setPhase(previous?.analysis || previous?.imported ? "ready" : "idle");
    setHome(previous?.home ?? true); setError(null); setModal(null); previousRef.current = null;
  }, []);

  const discardLive = useCallback(() => {
    liveRef.current?.cancel();
    liveRef.current = null;
    setLive(null); setLiveFrame(null); setLiveOverlay(null); setFinishing(false);
    restorePrevious();
  }, [restorePrevious]);

  const finishLive = useCallback(async () => {
    const capture = liveRef.current;
    if (!capture) return;
    liveRef.current = null;
    setFinishing(true);
    const result = await capture.stop();
    setLive(null); setLiveFrame(null); setLiveOverlay(null); setFinishing(false); setLimitHit(false);
    const tracked = resampleLive(result.samples, SAMPLE_FPS, result.duration);
    const seen = tracked.filter((f) => f.extraction).length;
    if (result.duration < 1 || seen < SAMPLE_FPS) {
      restorePrevious();
      setError("That take was too short to score. Go live again and dance for at least a second in full view.");
      setModal("new"); setNewMode("live"); setPhase("error");
      return;
    }
    const name = result.file?.name ?? `live-${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    if (previousRef.current?.src) URL.revokeObjectURL(previousRef.current.src);
    previousRef.current = null;
    setSrc(result.file ? URL.createObjectURL(result.file) : null);
    setAnalysis({ tracked, source: { name, duration: tracked.length / SAMPLE_FPS, fps: SAMPLE_FPS, width: result.width, height: result.height } });
    setTime(0); timeRef.current = 0;
    setPhase("ready"); setView("score");
    setToast("Take kept. The whole score has been re-read from it — press Play to explore.");
  }, [restorePrevious]);
  // The capture reports reaching its limit; the take is finished from here, with the current handlers.
  useEffect(() => { if (limitHit) void finishLive(); }, [limitHit, finishLive]);

  // Settings apply live as they do offline; the engine restarts the affected stage from here.
  useEffect(() => { live?.capture.engine.setGrid(grid); }, [live, grid]);
  useEffect(() => { live?.capture.engine.setSmooth(smooth); }, [live, smooth]);
  useEffect(() => { live?.capture.engine.setLift(lift); }, [live, lift]);
  // Leaving the page mid-take releases the camera.
  useEffect(() => () => { liveRef.current?.cancel(); }, []);

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
      // While the video has frames, its clock is the clock: a late start, a stall
      // or a dropped frame must not let the figures drift away from the picture.
      if (hasVideo && !v.paused && !v.ended && v.currentTime < v.duration - 0.02) {
        t = v.currentTime; start = t; t0 = performance.now();
      }
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
      if (home || modal) return;
      // Escape still reaches us from inside the settings sidebar, where focus sits on a control.
      if (e.code === "Escape") { if (selected) setSelected(null); else setSettingsOpen(false); return; }
      if ((e.target as HTMLElement)?.closest("input, select, textarea, button, a, [contenteditable=true], [role=slider]")) return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); step(e.shiftKey ? -10 : -1); }
      else if (e.code === "ArrowRight") { e.preventDefault(); step(e.shiftKey ? 10 : 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, step, home, modal, selected]);

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
    setToast(avatarPresetUrl ? "Your character is on stage. Press Play to see them move." : "Example ready. Press Play, then use the panel on the right to make it your own.");
  };

  const cancelTracking = () => {
    abortRef.current?.abort();
    if (liveRef.current) { discardLive(); return; }
    if (src) URL.revokeObjectURL(src);
    restorePrevious();
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

  const welcome = home || (!score && !busy && !src && !live);
  // The way back from the landing exists only once the studio has been open this visit; a score restored from storage waits quietly.
  const [studioSeen, setStudioSeen] = useState(false);
  if (!welcome && !studioSeen) setStudioSeen(true);
  const tab = settingsTab === "traces" && view !== "objects" ? "dancer" : settingsTab;
  const closeNew = () => { if (previousRef.current) cancelTracking(); else { setModal(null); setError(null); } };
  return (
    <div className={`app-shell flow-shell ${welcome ? "is-welcome" : "is-studio"}`}>
      <header className="app-header">
        <button className="brand-lockup" disabled={busy || !!live} onClick={() => { setHome(true); setPlaying(false); }} aria-label="vid2grid home">
          <span className="brand-mark"><Grid2X2 size={21} strokeWidth={1.7} /></span>
          <span className="brand-name">vid<span>2</span>grid</span>
          <span className="brand-descriptor">MOVEMENT<br />LANGUAGES</span>
        </button>
        {!welcome && <>
          <span className="project-chip" title={source?.name ?? undefined}>{live ? "Live take" : source?.name ?? "Creating your score"}</span>
          <nav className="seg view-tabs" aria-label="Choose a view">
            <button aria-pressed={view === "score"} onClick={() => setView("score")}><Box size={18} />3D stage</button>
            <button aria-pressed={view === "duet"} onClick={() => src || live ? setView("duet") : openModal("compare")}><Film size={18} />Compare</button>
            <button aria-pressed={view === "objects"} onClick={() => setView("objects")} disabled={!!live} title={live ? "Traces are drawn once the take is finished" : undefined}><ScanLine size={18} />Traces</button>
          </nav>
        </>}
        <div className="header-actions">
          {!welcome && <button className="btn" disabled={!score} onClick={() => openModal("details")}><List size={17} /><span className="tool-label">Notation</span></button>}
          <button className="btn" onClick={() => openModal("help")}><CircleHelp size={17} /><span className="help-label">Help</span></button>
          {welcome ? <>
            {studioSeen && score && <button className="btn" onClick={() => setHome(false)}><ArrowLeft size={17} />Back to studio</button>}
            <button className="btn" onClick={() => openNew("import")}>Open score</button>
          </> : <>
            <button className="btn" onClick={() => openNew()} disabled={busy || !!live}><Plus size={17} /><span className="tool-label">New score</span></button>
            <button className="btn primary" onClick={() => openModal("save")} disabled={!score}><Download size={17} /><span className="tool-label">Save</span></button>
          </>}
        </div>
      </header>

      {welcome && <Welcome onStart={() => openNew()} onDemo={loadDemo} />}
      {!welcome && <>
        <main className={`studio-workspace focused-workspace ${view === "duet" ? "compare-workspace" : ""} ${settingsOpen ? "" : "rail-settings"}`}>
          <section className={`source-panel ${view === "duet" ? "" : "source-hidden"}`} aria-label="Original video">
            <div className="panel-heading"><span><Film size={16} />{live ? "Camera" : "Original video"}</span></div>
            <div className="source-video relative">
              <VideoPane ref={videoRef} src={src} stream={live?.stream ?? null} crop={analysis?.source.crop ?? pendingCrop} overlay={overlay} showOverlay={showOverlay} onLoaded={onLoaded} onError={() => { abortRef.current?.abort(); setError("This video could not be decoded. Try an MP4 or WebM clip."); setPhase("error"); setModal("new"); }} />
              {view === "duet" && anchor && videoFigures.length > 0 && <VideoStage aspect={videoAspect} metresAcross={anchor.mpu} figures={videoFigures} />}
            </div>
          </section>
          <section className="stage-panel" aria-label={view === "objects" ? "Movement traces" : "3D movement stage"}>
            <div className="stage-heading"><span className="mono">{motion === "smooth" ? "SMOOTH" : `${grid.azStep}° GRID`}</span></div>
            {view === "objects" && score ? <Objects score={score} overlays={overlays} video={analysis ? videoEl : null} frame={fi} options={objects} /> :
              (snappedPose && curBody) || stageCast.length ? <Stage pose={stagePose} raw={stageRaw} body={stageBody} grid={grid} motion={motion} showRaw={showRaw} avatar={avatar} avatarUrl={avatarUrl} cast={stageCast} selected={selected} onSelect={setSelected} /> :
              <div className="stage-empty"><Activity size={35} /><span>{live ? "Looking for you. Step back so your whole body is in the picture." : "Your movement will appear here."}</span></div>}
            {view !== "objects" && <div className="stage-legend"><span><i className="bg-limb-l" />Left side</span><span><i className="bg-limb-r" />Right side</span><span className="stage-help">Drag to rotate · Pinch or scroll to zoom</span></div>}
            {selected && view !== "objects" && <button className="selected-limb" onClick={() => setSelected(null)}>{selected} · selected <X size={15} /></button>}
          </section>
          <aside className={`settings-sidebar ${settingsOpen ? "" : "is-rail"}`} aria-label="Studio settings">
            {settingsOpen ? <>
            <div className="sidebar-heading">
              <div className="insp-tabs" role="tablist" aria-label="Settings section">
                {RAIL.filter((r) => r.id !== "traces" || view === "objects").map((r) => (
                  <button key={r.id} role="tab" aria-selected={tab === r.id} title={r.label} onClick={() => setSettingsTab(r.id)}>
                    {r.icon}<span>{r.short}</span>{r.id === "cast" && cast.length > 0 && <b className="insp-badge">{cast.length}</b>}
                  </button>
                ))}
              </div>
              <button className="insp-icon" onClick={() => setSettingsOpen(false)} aria-label="Collapse settings" title="Collapse settings (Esc)"><PanelRightClose size={15} /></button>
            </div>
            <div className="sidebar-content">
              {(tab === "dancer" || tab === "grid") && <Controls panel={tab} grid={grid} smooth={smooth} onGrid={setGrid} onSmooth={setSmooth} lift={lift} onLift={setLift} canLift={!!analysis || !!live} showRaw={showRaw} onShowRaw={setShowRaw} avatar={avatar} onAvatar={setAvatar} avatarUrl={avatarUrl} avatarName={avatarName} onAvatarFile={onAvatarFile} onAvatarPreset={onAvatarPreset} showOverlay={showOverlay} onShowOverlay={setShowOverlay} motion={motion} onMotion={setMotion} size={size} onSize={setSize} inVideo={inVideo} onInVideo={setInVideo} beside={beside} onBeside={setBeside} selfDelay={selfDelay} onSelfDelay={setSelfDelay} />}
              {tab === "cast" && <CastPanel cast={cast} canAdd={!!score} beat={60 / bpm} onAdd={() => { addToCast(); setToast("Dancer added to your cast."); }} onCanon={(voices, gap) => { addCanon(voices, gap); setToast(`Canon added: ${voices} voices, ${gap.toFixed(2)} s apart.`); }} onDuplicate={duplicateCast} onRemove={removeCast} onUpdate={updateCast} />}
              {tab === "traces" && score && <>
                <Section title="Traces">
                  <Switch label="Movement trails" hint="Follow the hands, feet, and head through space." checked={objects.traces} onChange={(traces) => setObjects({ ...objects, traces })} />
                  <NumSlider label="Length" value={objects.trailSeconds} min={0.2} max={6} step={0.1} decimals={1} unit="s" disabled={!objects.traces} onChange={(trailSeconds) => setObjects({ ...objects, trailSeconds })} />
                  <Switch label="Alignments" hint="Highlight parallel and aligned limbs." checked={objects.alignments} onChange={(alignments) => setObjects({ ...objects, alignments })} />
                  <Switch label="Density" hint="Reveal the areas where movement gathers." checked={objects.density} onChange={(density) => setObjects({ ...objects, density })} />
                  <Switch label="Video plate" hint={analysis ? "Show the recording behind the traces." : "Available when you add a video."} checked={objects.video} disabled={!analysis} onChange={(video) => setObjects({ ...objects, video })} />
                </Section>
                <Section title="Whole phrase" aside={<span className="insp-aside">every trace, once</span>}>
                  <div className="insp-drawing"><Drawing score={score} overlays={overlays} /></div>
                </Section>
              </>}
            </div>
            </> : (
            <div className="sidebar-rail">
              {RAIL.filter((r) => r.id !== "traces" || view === "objects").map((r) => (
                <button key={r.id} title={r.label} aria-label={r.label}
                  onClick={() => { setSettingsTab(r.id); setSettingsOpen(true); }}>{r.icon}</button>
              ))}
            </div>
            )}
          </aside>
        </main>
        {live && <footer className="studio-timeline"><LiveBar elapsed={time} keyframes={liveFrame?.keyframes ?? 0} ready={!!liveFrame} finishing={finishing} onFinish={finishLive} onDiscard={discardLive} /></footer>}
        {score && !live && <footer className="studio-timeline"><Timeline score={score} total={stageDuration} time={time} playing={playing} onSeek={seek} onTogglePlay={togglePlay} onStep={step} selected={selected} onSelect={setSelected} speed={speed} onSpeed={setSpeed} loop={loop} onLoop={() => setLoop((l) => !l)} tempo={tempo} bpm={bpm} onBpm={onBpm} /></footer>}
      </>}

      <Dialog open={modal === "new"} title={busy ? "Creating your score" : "Start a new score"} description={busy ? "Your video is being processed on this device." : "A video, a recording, or a saved score. Choose where to begin."} onClose={closeNew} locked={busy}>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <NewScore initialMode={newMode} onFile={onFile} onImport={importJson} onDemo={loadDemo} onLive={startLive} busy={busy} progress={progress} loading={phase === "loading"} onCancel={cancelTracking} />
      </Dialog>
      <Dialog open={modal === "save"} title="Save your movement" description="Download a reusable copy of the current dancer’s score." onClose={() => setModal(null)}>
        {score && <SaveScore key={score.source.name} score={score} onSave={exportJson} />}
      </Dialog>
      <Dialog open={modal === "details"} title="Read the movement" description="Directions for the current frame. Select a limb to highlight it on the stage." onClose={() => setModal(null)} wide>
        {snappedPose && rawPose && <><div className="notation-scroll"><BoneTable snapped={snappedPose} raw={rawPose} selected={selected} onSelect={(id) => { setSelected(id); setModal(null); setView("score"); }} /></div><p className="dialog-note">Grid: snapped angles. Laban: direction and level. E-W: Eshkol–Wachman units. Raw: the tracked angles before snapping.</p></>}
      </Dialog>
      <Dialog open={modal === "compare"} title="Compare needs a video" description="This score contains movement data, but no original recording." onClose={() => setModal(null)}>
        <div className="empty-dialog"><Film size={35} /><p>Create a score from your own video to watch the recording and 3D dancer together.</p><button className="btn primary" onClick={() => openNew()}>Choose a video</button><button className="btn" onClick={() => setModal(null)}>Back to the stage</button></div>
      </Dialog>
      <Dialog open={modal === "help"} title="A quick tour" description="From a video to a movement you can explore." onClose={() => setModal(null)}>
        <div className="help-steps"><div><Film size={23} /><span><strong>1. Create a score</strong><p>Choose or record a short video and tap Create movement score, or go live and dance in front of the camera. Or open an example to try things out.</p></span></div><div><Box size={23} /><span><strong>2. Explore the phrase</strong><p>Press Play. Drag the dancer to rotate the view. Compare shows your source video; Traces reveals movement paths.</p></span></div><div><SlidersHorizontal size={23} /><span><strong>3. Make it yours</strong><p>The panel on the right changes the dancer, movement detail, and cast as you watch. Notation explains the selected frame. Save downloads the current dancer’s score.</p></span></div></div>
        <div className="help-shortcuts"><span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd><kbd>→</kbd> Step frames</span></div>
        <div className="dialog-footer"><span>Appearance</span><ThemeToggle /></div><button className="btn primary dialog-primary" onClick={() => setModal(null)}>Got it</button>
      </Dialog>
      {toast && <div className="studio-toast" role="status"><Check size={18} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16} /></button></div>}
    </div>
  );
}

const emptySubscribe = () => () => {};

/** MediaRecorder webm files report an Infinite duration until seeked past the end; make it resolve. */
function resolveDuration(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); video.removeEventListener("durationchange", done); signal?.removeEventListener("abort", aborted); };
    const done = () => { if (Number.isFinite(video.duration)) { cleanup(); video.currentTime = 0; resolve(); } };
    const aborted = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Could not read this clip’s duration. Try exporting it as MP4.")); }, 10000);
    video.addEventListener("durationchange", done);
    signal?.addEventListener("abort", aborted, { once: true });
    video.currentTime = 1e101;
  });
}

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
