"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import { ArrowLeft, Box, Check, CircleHelp, Columns2, Download, Film, Grid2X2, Moon, PanelRightClose, Plus, ScanLine, SlidersHorizontal, Sun, X, PersonStanding, Users, UserPlus, List, Activity, ImageDown, RotateCcw, Target } from "lucide-react";
import Dialog from "./Dialog";
import NewScore, { type DanceAlongChoice } from "./NewScore";
import SaveScore from "./SaveScore";
import Welcome from "./Welcome";
import { createDemo, type DemoPhrase } from "@/lib/demo";
import { DEFAULT_AVATAR_URL } from "@/lib/avatars";
import CastPanel, { type CastMember, type CastPatch, type Lead } from "./Cast";
import AddDancer, { type AddProgress, type Look, freshLook } from "./AddDancer";
import CharacterGrid, { lookLabel } from "./CharacterGrid";
import { useAvatarLoading } from "./Avatar";
import { AVATAR_PRESETS, avatarFile } from "@/lib/avatars";
import type { StageCastMember } from "./Stage";
import { type Devices, NO_DEVICES, clipTime, memberSpan, mirrorBody, mirrorPose, placePose, sanitizeDevices, scaleBody, scalePose } from "@/lib/devices";
import { imageToWorld, videoAnchors } from "@/lib/invideo";
import { type Cue, DEFAULT_TRANSITION, placementsAt, sanitizeCues } from "@/lib/formations";
import { idbGet, idbSet } from "@/lib/store";
import VideoPane from "./VideoPane";
import Timeline from "./Timeline";
import LiveBar from "./LiveBar";
import BoneTable from "./BoneTable";
import Controls from "./Controls";
import { Chips, Colour, Note, NumSlider, Section, Seg, Switch } from "./Inspector";
import Objects, { DEFAULT_OBJECTS, Drawing, type ObjectsHandle, type ObjectsOptions } from "./Objects";
import { DEFAULT_TRACE_STYLE, TRACE_GROUPS, TRACE_PRESETS, type TraceStyle } from "@/lib/traces";
import { DEFAULT_GRID, type GridConfig } from "@/lib/grid";
import { DEFAULT_SMOOTH, type LiftMode, type Score, type SmoothConfig, type SourceInfo, buildScore, frameAt, measureBody, parseScore, rawPoses, serializeScore, smoothPoses, snapPoses } from "@/lib/score";
import { fillGaps, getLandmarker, trackPeople } from "@/lib/tracker";
import { type Analysis, checkDuration, nobodyFound, offsetBetween, resolveDuration, trackFile } from "@/lib/clip";
import { LiveCapture } from "@/lib/capture";
import { type LiveFrame, LiveScore, resampleLive } from "@/lib/live";
import { CORE_BONES, DEFAULT_MATCH, type FrameMatch, type MatchSummary, MatchTracker, grade, matchAt } from "@/lib/match";
import { BONE } from "@/lib/skeleton";
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
type View = "both" | "video" | "score" | "objects";
const SAMPLE_FPS = 30;
const LS_KEY = "vid2grid:last-score";
const CAST_KEY = "vid2grid:cast";
const CUES_KEY = "vid2grid:formations";
const NO_PLACE = { x: 0, z: 0, rot: 0 };
const Stage = dynamic(() => import("./Stage"), {
  ssr: false,
  loading: () => <div role="status" className="grid h-full place-items-center text-xs text-white/60">Preparing the stage…</div>,
});
const VideoStage = dynamic(() => import("./VideoStage"), { ssr: false });

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 1 });
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"new" | "save" | "details" | "help" | "compare" | "add" | "look" | "report" | null>(null);
  /** The cast member whose look is being changed. */
  const [lookFor, setLookFor] = useState<string | null>(null);
  const [newMode, setNewMode] = useState<"upload" | "import" | "live">("upload");
  const [settingsTab, setSettingsTab] = useState<"dancer" | "grid" | "cast" | "traces">("dancer");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [motion, setMotion] = useState<"stepped" | "smooth">("stepped");
  const [toast, setToast] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  /** Region of the clip being tracked, chosen in the preview; the analysis records its own once done. */
  const [pendingCrop, setPendingCrop] = useState<Crop | null>(null);
  /** People to follow in the clip being tracked, one dancer each: the first is the lead, the rest join the cast. */
  const [pendingFollow, setPendingFollow] = useState<PersonPick[]>([]);
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
  /** Dance-along: the dance being copied plays beside the live dancer and every frame is scored against it (lib/match.ts). */
  const [along, setAlong] = useState<{ target: Score; look: string | null; mirror: boolean } | null>(null);
  const alongRef = useRef<{ target: Score; mirror: boolean; step: number; tracker: MatchTracker } | null>(null);
  const [matchNow, setMatchNow] = useState<FrameMatch | null>(null);
  const [matchMean, setMatchMean] = useState(0);
  /** The report of the last dance-along take. */
  const [report, setReport] = useState<{ summary: MatchSummary; dance: string } | null>(null);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [home, setHome] = useState(true);
  const timeRef = useRef(0);
  const [selected, setSelected] = useState<BoneId | null>(null);
  const [showRaw, setShowRaw] = useState(true);
  const [kinesphere, setKinesphere] = useState(false);
  const [avatar, setAvatar] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(DEFAULT_AVATAR_URL);
  const [avatarName, setAvatarName] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  /** What fills the workspace: the video beside the stage (the main way of watching), the video alone, the stage alone, or the traces. */
  const [view, setView] = useState<View>("score");
  const [objects, setObjects] = useState<ObjectsOptions>(DEFAULT_OBJECTS);
  const [traceStyle, setTraceStyle] = useState<TraceStyle>(DEFAULT_TRACE_STYLE);
  const objectsRef = useRef<ObjectsHandle>(null);
  const [cast, setCast] = useState<CastMember[]>([]);
  /** Formations: where everyone stands over the stage clock (lib/formations.ts). Empty = each member's own placement. */
  const [cues, setCues] = useState<Cue[]>([]);
  const [transition, setTransition] = useState(DEFAULT_TRANSITION);
  /** Side by side and Video views: draw the character and the cast inside the recording, beside the person. */
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
  const savePicture = useCallback(async () => {
    const blob = await objectsRef.current?.toPng();
    if (!blob) { setToast("Nothing to save yet."); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(source?.name ?? "dance").replace(/\.[^.]+$/, "")}-traces.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    setToast("Picture saved.");
  }, [source]);
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
  // Formations, when there are any, say where everyone stands right now: the lead is index 0, then the cast in order.
  const placements = useMemo(() => placementsAt(cues, 1 + cast.length, time, transition), [cues, cast.length, time, transition]);
  const leadPlace = placements?.[0] ?? null;
  const stagePose = useMemo(() => (snappedPose ? placePose(scalePose(snappedPose, size), leadPlace ?? NO_PLACE) : null), [snappedPose, size, leadPlace]);
  const stageRaw = useMemo(() => (rawPose ? placePose(scalePose(rawPose, size), leadPlace ?? NO_PLACE) : null), [rawPose, size, leadPlace]);
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

  const cuesLoaded = useRef(false);
  useEffect(() => {
    let alive = true;
    idbGet<{ cues: unknown; transition: unknown }>(CUES_KEY).then((v) => {
      if (!alive) return;
      cuesLoaded.current = true;
      const restored = sanitizeCues(v?.cues);
      if (restored.length) setCues(restored);
      if (typeof v?.transition === "number" && Number.isFinite(v.transition)) setTransition(Math.max(0, Math.min(10, v.transition)));
    }).catch(() => { cuesLoaded.current = true; });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!cuesLoaded.current) return;
    const id = setTimeout(() => { idbSet(CUES_KEY, { cues, transition }).catch(() => {}); }, 500);
    return () => clearTimeout(id);
  }, [cues, transition]);

  /** Slots across the stage not yet taken, nearest the centre first: −1, 1, −2, 2 … metres. */
  const freeSlots = (taken: number[], n: number): number[] => {
    const out: number[] = [];
    for (let k = 1; out.length < n; k++) for (const x of [-k, k]) if (out.length < n && !taken.some((t) => Math.abs(t - x) < 0.5)) out.push(x);
    return out;
  };
  /**
   * Put dancers on the stage: each a dance, its devices and a look (a
   * character nobody is wearing, when none is given). Each takes a free
   * slot nearest the centre — or, given a place, stands that far from the
   * group's origin: the stage centre, where the lead is, or the first free
   * slot. People tracked from one clip stand where they stood in it.
   */
  const addMembers = useCallback((specs: { score: Score; look?: Look; devices?: Partial<Devices>; place?: { x: number; z: number } }[], origin: "centre" | "slot" = "slot") => {
    setCast((c) => {
      const slots = freeSlots(c.map((m) => m.x), specs.length);
      const base = origin === "centre" ? 0 : slots[0];
      const worn: (string | null)[] = [avatar ? avatarUrl : null, ...c.map((m) => m.avatarUrl), ...specs.map((sp) => sp.look?.avatarUrl ?? null)];
      return [...c, ...specs.map((sp, i) => {
        const look = sp.look ?? freshLook(worn);
        if (!sp.look) worn.push(look.avatarUrl);
        return {
          id: crypto.randomUUID(),
          name: lookLabel(look.avatarUrl, look.avatarName),
          score: sp.score,
          avatarUrl: look.avatarUrl,
          x: sp.place ? base + sp.place.x : slots[i], z: sp.place?.z ?? 0, rot: 0,
          ...NO_DEVICES, ...sp.devices,
        };
      })];
    });
  }, [avatar, avatarUrl]);
  const showCast = useCallback(() => { setModal(null); setError(null); setSettingsTab("cast"); setSettingsOpen(true); }, []);
  /** This dance again: one more dancer, or several entering `gapBeats` apart (a canon). */
  const addThis = useCallback((look: Look, count: number, gapBeats: number) => {
    if (!score) return;
    const gap = gapBeats * 60 / bpm;
    addMembers(Array.from({ length: count }, (_, k) => ({ score, look, devices: { size, delay: Math.round((k + 1) * gap * 100) / 100 } })));
    showCast();
    setToast(count > 1 ? `${count} dancers added${gap > 0 ? `, entering ${gap.toFixed(2)} s apart` : ", in unison"}.` : `${lookLabel(look.avatarUrl, look.avatarName)} is on the stage.`);
  }, [score, bpm, size, addMembers, showCast]);
  const addSaved = useCallback((file: File, look: Look) => {
    if (file.size > 25 * 1024 * 1024) { setError("Choose a dance smaller than 25 MB."); return; }
    file.text().then((t) => {
      const sc = parseScore(t);
      addMembers([{ score: sc, look }]);
      showCast();
      setToast(`${lookLabel(look.avatarUrl, look.avatarName)} is on the stage, dancing ${sc.source.name}.`);
    }).catch((e) => { setError(e instanceof Error ? e.message : "Could not open this dance."); });
  }, [addMembers, showCast]);
  const addExample = useCallback((phrase: DemoPhrase, look: Look) => {
    const sc = createDemo(phrase);
    addMembers([{ score: sc, look }]);
    showCast();
    setToast(`${lookLabel(look.avatarUrl, look.avatarName)} is on the stage, dancing ${sc.source.name}.`);
  }, [addMembers, showCast]);
  /* Another video for a new dancer: tracked off screen, the dance on the stage untouched. */
  const [addProgress, setAddProgress] = useState<AddProgress | null>(null);
  const addAbortRef = useRef<AbortController | null>(null);
  const addFile = useCallback(async (file: File, look: Look, crop?: Crop, follow?: PersonPick[]) => {
    addAbortRef.current?.abort();
    const ac = new AbortController();
    addAbortRef.current = ac;
    setError(null);
    setAddProgress({ stage: "loading", done: 0, total: 1 });
    try {
      const people = await trackFile(file, {
        fps: SAMPLE_FPS, crop, follow, signal: ac.signal,
        onTracking: () => setAddProgress({ stage: "tracking", done: 0, total: 1 }),
        onProgress: (done, total) => setAddProgress({ stage: "tracking", done, total }),
      });
      if (ac.signal.aborted) return;
      // The first wears the chosen look and takes a free slot; the others stand where they stood beside them in the clip.
      addMembers(people.map((a, k) => ({
        score: buildScore(fillGaps(a.tracked, a.source.fps), a.source, grid, smooth, lift),
        look: k ? undefined : look,
        place: k ? offsetBetween(people[0].tracked, a.tracked) : { x: 0, z: 0 },
      })));
      showCast();
      setToast(people.length > 1 ? `${people.length} dancers are on the stage, dancing ${file.name}.` : `${lookLabel(look.avatarUrl, look.avatarName)} is on the stage, dancing ${file.name}.`);
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(describeError(e));
    } finally {
      if (addAbortRef.current === ac) { addAbortRef.current = null; setAddProgress(null); }
    }
  }, [grid, smooth, lift, addMembers, showCast]);
  const cancelAdd = useCallback(() => { addAbortRef.current?.abort(); addAbortRef.current = null; setAddProgress(null); }, []);
  useEffect(() => () => { addAbortRef.current?.abort(); }, []);
  const duplicateCast = useCallback((id: string) => {
    setCast((c) => {
      const m = c.find((d) => d.id === id);
      return m ? [...c, { ...m, id: crypto.randomUUID(), x: freeSlots(c.map((d) => d.x), 1)[0] }] : c;
    });
  }, []);
  const removeCast = useCallback((id: string) => setCast((c) => c.filter((d) => d.id !== id)), []);
  const updateCast = useCallback((id: string, patch: CastPatch) => {
    setCast((c) => c.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);
  const setMemberLook = useCallback((id: string, avatarUrl: string | null, customName?: string) => {
    updateCast(id, { avatarUrl, name: lookLabel(avatarUrl, customName) });
  }, [updateCast]);
  const lookMember = lookFor ? cast.find((m) => m.id === lookFor) ?? null : null;
  const lead: Lead | null = score ? { name: lookLabel(avatar ? avatarUrl : null, avatarName), dance: score.source.name.replace(/\.[^.]+$/, ""), avatarUrl: avatar ? avatarUrl : null } : null;
  const usedLooks = [avatar ? avatarUrl : null, ...cast.map((m) => m.avatarUrl)];
  // Characters on their way: the stick figure dances meanwhile, this says who is coming.
  const avatarLoads = useAvatarLoading();
  const dressing = avatarLoads.length ? (() => {
    const names = avatarLoads.map((l) => AVATAR_PRESETS.find((a) => avatarFile(a.url) === l.url)?.label ?? "character");
    const done = avatarLoads.reduce((n, l) => n + l.done, 0), total = avatarLoads.reduce((n, l) => n + l.total, 0);
    return { text: names.length === 1 ? `Dressing ${names[0]}` : `Dressing ${names.length} characters`, pct: total ? Math.round(done / total * 100) : null };
  })() : null;

  // The stage clock runs to the longest dancer (delay and speed included); shorter ones hold their last pose.
  const stageDuration = useMemo(
    () => Math.max((score?.source.duration ?? 0) + (inVideo ? selfDelay : 0), ...cast.map((m) => memberSpan(m.score.source.duration, m))),
    [score, cast, inVideo, selfDelay],
  );
  // Each member at the stage clock, through its devices, with its floor placement baked in.
  // Same track as the live figure (snapped or smooth), or the stage disagrees with itself.
  const stageCast: StageCastMember[] = useMemo(() => cast.map((m, i) => {
    const track = motion === "smooth" ? m.score.raw : m.score.frames;
    const p = track[frameAt(m.score, clipTime(time, m.score.source.duration, m))];
    const pose = scalePose(placePose(m.mirror ? mirrorPose(p) : p, placements?.[i + 1] ?? m), m.size);
    return { id: m.id, pose, body: scaleBody(m.mirror ? mirrorBody(m.score.body) : m.score.body, m.size), avatarUrl: m.avatarUrl };
  }), [cast, time, motion, placements]);
  // Dance-along: the target dances beside the live dancer — mirrored when they copy it as a mirror — and holds its last pose when it ends.
  const alongMember: StageCastMember | null = useMemo(() => {
    if (!along || !live) return null;
    const track = motion === "smooth" ? along.target.raw : along.target.frames;
    const p = track[frameAt(along.target, time)];
    return { id: "dance-along", pose: placePose(along.mirror ? mirrorPose(p) : p, { x: 1.3, z: 0, rot: 0 }), body: along.mirror ? mirrorBody(along.target.body) : along.target.body, avatarUrl: along.look };
  }, [along, live, motion, time]);
  const shownCast = useMemo(() => (alongMember ? [alongMember, ...stageCast] : stageCast), [alongMember, stageCast]);

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
    // The cast keeps its stage offsets from the lead — the lead's own formation placement included.
    const lx = live.x + (leadPlace?.x ?? 0), lz = live.z + (leadPlace?.z ?? 0);
    for (const m of stageCast) out.push({ ...m, pose: { ...m.pose, x: at.x + (m.pose.x - lx), z: m.pose.z - lz, hipY: at.y + m.pose.hipY } });
    return out;
  }, [inVideo, anchor, score, body, size, fi, time, selfDelay, motion, videoAspect, beside, avatar, avatarUrl, stageCast, leadPlace]);

  /* ---------- getting a clip in ---------- */

  const onFile = useCallback((file: File, crop?: Crop, follow?: PersonPick[]) => {
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
    setPendingFollow(follow ?? []);
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
      checkDuration(video.duration);
      video.pause();
      // On a first visit the tracker is still downloading; keep "preparing" up until it is here,
      // rather than a progress bar stuck at 0%.
      await getLandmarker();
      if (ac.signal.aborted) return;
      setPhase("tracking");
      const fps = SAMPLE_FPS;
      const total = Math.floor(video.duration * fps);
      setProgress({ done: 0, total });
      const crop = pendingCrop ?? undefined;
      const people = await trackPeople(video, {
        fps,
        crop,
        follow: pendingFollow,
        signal: ac.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (ac.signal.aborted) return;
      const [tracked, ...others] = people;
      if (!tracked.some((f) => f.extraction)) throw nobodyFound(pendingFollow.length > 0, !!crop);
      const px = crop ? cropPixels(crop, video.videoWidth, video.videoHeight) : { w: video.videoWidth, h: video.videoHeight };
      const source: SourceInfo = { name: fileNameRef.current, duration: video.duration, fps, width: px.w, height: px.h, crop };
      setAnalysis({ tracked, source });
      // The other people picked join the cast, standing where they stood beside the lead in the clip.
      const extras = others.filter((t) => t.some((f) => f.extraction));
      if (extras.length) addMembers(extras.map((t) => ({ score: buildScore(fillGaps(t, fps), source, grid, smooth, lift), place: offsetBetween(tracked, t) })), "centre");
      video.currentTime = 0;
      setTime(0);
      setPhase("ready");
      if (previousRef.current?.src) URL.revokeObjectURL(previousRef.current.src);
      previousRef.current = null;
      setModal(null); setView("both");
      setToast(extras.length ? `Your dance is ready, with ${extras.length} more ${extras.length > 1 ? "dancers" : "dancer"} from the clip in the cast. Press Play to explore the movement.` : "Your dance is ready. Press Play to explore the movement.");
    } catch (e) {
      if (ac.signal.aborted) return; // superseded by a newer clip
      setError(describeError(e));
      setPhase("error");
    }
  }, [analysis, pendingCrop, pendingFollow, grid, smooth, lift, addMembers]);

  /* ---------- a live take ---------- */

  const startLive = useCallback((choice: DanceAlongChoice | null = null) => {
    abortRef.current?.abort();
    // Dance-along: the dance on the stage becomes the target, in a look nobody is wearing.
    if (choice && score) {
      const tracker = new MatchTracker();
      alongRef.current = { target: score, mirror: choice.mirror, step: Math.max(grid.azStep, grid.elStep), tracker };
      setAlong({ target: score, look: freshLook([avatar ? avatarUrl : null, ...cast.map((m) => m.avatarUrl)]).avatarUrl, mirror: choice.mirror });
    } else { alongRef.current = null; setAlong(null); }
    setMatchNow(null); setMatchMean(0);
    if (!previousRef.current) previousRef.current = { analysis, imported, src, time: timeRef.current, home };
    if (src && src !== previousRef.current.src) URL.revokeObjectURL(src);
    setSrc(null); setAnalysis(null); setImported(null); setVideoEl(null);
    setPlaying(false); setTime(0); timeRef.current = 0;
    setLiveFrame(null); setLiveOverlay(null); setFinishing(false);
    setHome(false); setError(null); setPhase("loading"); setModal("new"); setSelected(null);
    setView((v) => (v === "objects" ? "both" : v));
    const engine = new LiveScore({ grid, smooth, lift });
    const capture: LiveCapture = new LiveCapture({
      engine,
      fps: SAMPLE_FPS,
      onFrame: (frame, image, t) => {
        setLiveFrame(frame); setLiveOverlay(image); timeRef.current = t; setTime(t);
        const a = alongRef.current;
        if (a && frame) {
          const m = matchAt(frame.snapped, a.target, t, { ...DEFAULT_MATCH, step: a.step, mirror: a.mirror });
          if (m) { a.tracker.push(m, t); setMatchMean(a.tracker.summary().score); }
          setMatchNow(m);
        }
      },
      onLimit: () => setLimitHit(true),
      onError: (e) => { capture.cancel(); liveRef.current = null; setLive(null); setError(describeError(e)); setPhase("error"); setModal("new"); },
    });
    liveRef.current = capture;
    capture.open().then((stream) => {
      if (liveRef.current !== capture) { capture.cancel(); return; } // superseded
      setLive({ capture, stream });
      setPhase("live");
      setModal(null);
      setToast(choice ? "You're live. Dance along — every limb is scored against the dance beside you." : "You're live. Move — the dance is written as you go.");
    }).catch((e) => {
      if (liveRef.current === capture) liveRef.current = null;
      setError(e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
        ? "The camera was not allowed. Give this page camera access, then try again."
        : describeError(e));
      setPhase("error");
    });
  }, [analysis, imported, src, home, grid, smooth, lift, score, avatar, avatarUrl, cast]);

  const restorePrevious = useCallback(() => {
    const previous = previousRef.current;
    setSrc(previous?.src ?? null); setAnalysis(previous?.analysis ?? null); setImported(previous?.imported ?? null); setPendingCrop(null); setPendingFollow([]);
    timeRef.current = previous?.time ?? 0; setTime(timeRef.current);
    setPhase(previous?.analysis || previous?.imported ? "ready" : "idle");
    setHome(previous?.home ?? true); setError(null); setModal(null); previousRef.current = null;
  }, []);

  const discardLive = useCallback(() => {
    liveRef.current?.cancel();
    liveRef.current = null;
    setLive(null); setLiveFrame(null); setLiveOverlay(null); setFinishing(false);
    alongRef.current = null; setAlong(null); setMatchNow(null);
    restorePrevious();
  }, [restorePrevious]);

  const finishLive = useCallback(async () => {
    const capture = liveRef.current;
    if (!capture) return;
    liveRef.current = null;
    setFinishing(true);
    const result = await capture.stop();
    // A dance-along ends with its report; the take is kept like any other.
    const a = alongRef.current;
    const summary = a && a.tracker.frames > 0 ? { summary: a.tracker.summary(), dance: a.target.source.name.replace(/\.[^.]+$/, "") } : null;
    alongRef.current = null; setAlong(null); setMatchNow(null);
    setLive(null); setLiveFrame(null); setLiveOverlay(null); setFinishing(false); setLimitHit(false);
    const tracked = resampleLive(result.samples, SAMPLE_FPS, result.duration);
    const seen = tracked.filter((f) => f.extraction).length;
    if (result.duration < 1 || seen < SAMPLE_FPS) {
      restorePrevious();
      setError("That take was too short. Go live again and dance for at least a second in full view.");
      setModal("new"); setNewMode("live"); setPhase("error");
      return;
    }
    const name = result.file?.name ?? `live-${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    if (previousRef.current?.src) URL.revokeObjectURL(previousRef.current.src);
    previousRef.current = null;
    setSrc(result.file ? URL.createObjectURL(result.file) : null);
    setAnalysis({ tracked, source: { name, duration: tracked.length / SAMPLE_FPS, fps: SAMPLE_FPS, width: result.width, height: result.height } });
    setTime(0); timeRef.current = 0;
    setPhase("ready"); setView("both");
    if (summary) { setReport(summary); setModal("report"); }
    setToast(summary ? `Take kept. You matched ${Math.round(summary.summary.score * 100)}% of ${summary.dance}.` : "Take kept. The whole dance has been re-read from it — press Play to explore.");
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
    setModal(null); setToast("Dance download started. Reopen it from New dance → Open dance.");
  };
  const importJson = (file: File) => {
    if (file.size > 25 * 1024 * 1024) { setError("Choose a dance smaller than 25 MB."); return; }
    file.text().then((t) => {
      const sc = parseScore(t);
      abortRef.current?.abort();
      if (previousRef.current?.src && previousRef.current.src !== src) URL.revokeObjectURL(previousRef.current.src);
      previousRef.current = null;
      if (src) URL.revokeObjectURL(src);
      setSrc(null); setAnalysis(null); setImported(sc); setGrid(sc.grid); setSmooth(sc.smooth); setLift(sc.lift); setHome(false); timeRef.current = 0;
      setTime(0); setPlaying(false); setPhase("ready"); setError(null); setModal(null); setToast("Dance opened. Press Play to explore it.");
      setView((v) => (v === "both" || v === "video" ? "score" : v)); // those need a video
    }).catch((e) => { setError(e instanceof Error ? e.message : "Could not open this dance."); });
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
  /** A recording or the camera to show; without one, only the stage and the traces make sense. */
  const hasVideo = !!src || !!live;
  const showVideo = view === "both" || view === "video";
  const closeNew = () => { if (previousRef.current) cancelTracking(); else { setModal(null); setError(null); } };
  return (
    <div className={`app-shell flow-shell ${welcome ? "is-welcome" : "is-studio"}`}>
      <header className="app-header">
        <button className="brand-lockup" disabled={busy || !!live} onClick={() => { setHome(true); setPlaying(false); }} aria-label="Visual Elbow home">
          <span className="brand-mark"><Grid2X2 size={21} strokeWidth={1.7} /></span>
          <span className="brand-name">visual<span>elbow</span></span>
          <span className="brand-descriptor">MOVEMENT<br />LANGUAGES</span>
        </button>
        {!welcome && <>
          <span className="project-chip" title={source?.name ?? undefined}>{live ? "Live take" : source?.name ?? "Creating your dance"}</span>
          <nav className="seg view-tabs" aria-label="Choose a view">
            <button aria-pressed={view === "both"} onClick={() => hasVideo ? setView("both") : openModal("compare")} title="The video and the stage together"><Columns2 size={18} />Side by side</button>
            <button aria-pressed={view === "video"} onClick={() => hasVideo ? setView("video") : openModal("compare")} title="Only the video, with the characters inside it"><Film size={18} />Video</button>
            <button aria-pressed={view === "score"} onClick={() => setView("score")} title="Only the 3D stage"><Box size={18} />Stage</button>
            <button aria-pressed={view === "objects"} onClick={() => setView("objects")} disabled={!!live} title={live ? "Traces are drawn once the take is finished" : "Movement paths"}><ScanLine size={18} />Traces</button>
          </nav>
        </>}
        <div className="header-actions">
          {!welcome && <button className="btn" disabled={busy || !!live} onClick={() => openModal("add")} title="Put another dancer on the stage"><UserPlus size={17} /><span className="tool-label">Add dancer</span></button>}
          {!welcome && <button className="btn" disabled={!score} onClick={() => openModal("details")}><List size={17} /><span className="tool-label">Notation</span></button>}
          <button className="btn" onClick={() => openModal("help")}><CircleHelp size={17} /><span className="help-label">Help</span></button>
          {welcome ? <>
            {studioSeen && score && <button className="btn" onClick={() => setHome(false)}><ArrowLeft size={17} />Back to studio</button>}
            <button className="btn" onClick={() => openNew("import")}>Open dance</button>
          </> : <>
            <button className="btn" onClick={() => openNew()} disabled={busy || !!live}><Plus size={17} /><span className="tool-label">New dance</span></button>
            <button className="btn primary" onClick={() => openModal("save")} disabled={!score}><Download size={17} /><span className="tool-label">Save</span></button>
          </>}
        </div>
      </header>

      {welcome && <Welcome onStart={() => openNew()} onDemo={loadDemo} />}
      {!welcome && <>
        <main className={`studio-workspace focused-workspace ${view === "both" ? "compare-workspace" : ""} ${view === "video" ? "video-workspace" : ""} ${settingsOpen ? "" : "rail-settings"}`}>
          <section className={`source-panel ${showVideo ? "" : "source-hidden"}`} aria-label="Original video">
            <div className="panel-heading"><span><Film size={16} />{live ? "Camera" : "Original video"}</span></div>
            <div className="source-video relative">
              <VideoPane ref={videoRef} src={src} stream={live?.stream ?? null} crop={analysis?.source.crop ?? pendingCrop} overlay={overlay} showOverlay={showOverlay} onLoaded={onLoaded} onError={() => { abortRef.current?.abort(); setError("This video could not be decoded. Try an MP4 or WebM clip."); setPhase("error"); setModal("new"); }} />
              {showVideo && anchor && videoFigures.length > 0 && <VideoStage aspect={videoAspect} metresAcross={anchor.mpu} figures={videoFigures} />}
            </div>
          </section>
          <section className={`stage-panel ${view === "video" ? "stage-hidden" : ""}`} aria-label={view === "objects" ? "Movement traces" : "3D movement stage"}>
            <div className="stage-heading"><span className="mono">{motion === "smooth" ? "SMOOTH" : `${grid.azStep}° GRID`}</span></div>
            {view === "objects" && score ? <Objects ref={objectsRef} score={score} overlays={overlays} video={analysis ? videoEl : null} frame={fi} options={objects} style={traceStyle} /> :
              (snappedPose && curBody) || shownCast.length ? <Stage pose={stagePose} raw={stageRaw} body={stageBody} grid={grid} motion={motion} showRaw={showRaw} kinesphere={kinesphere} avatar={avatar} avatarUrl={avatarUrl} cast={shownCast} selected={selected} onSelect={setSelected} /> :
              <div className="stage-empty"><Activity size={35} /><span>{live ? "Looking for you. Step back so your whole body is in the picture." : "Your movement will appear here."}</span></div>}
            {view !== "objects" && <div className="stage-legend"><span><i className="bg-limb-l" />Left side</span><span><i className="bg-limb-r" />Right side</span><span className="stage-help">Drag to rotate · Pinch or scroll to zoom</span></div>}
            {selected && view !== "objects" && <button className="selected-limb" onClick={() => setSelected(null)}>{selected} · selected <X size={15} /></button>}
            {dressing && view !== "objects" && <div className="stage-dressing" role="status"><span className="status-dot" />{dressing.text}{dressing.pct !== null && <b>{dressing.pct}%</b>}</div>}
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
              {(tab === "dancer" || tab === "grid") && <Controls panel={tab} grid={grid} smooth={smooth} onGrid={setGrid} onSmooth={setSmooth} lift={lift} onLift={setLift} canLift={!!analysis || !!live} showRaw={showRaw} onShowRaw={setShowRaw} kinesphere={kinesphere} onKinesphere={setKinesphere} avatar={avatar} onAvatar={setAvatar} avatarUrl={avatarUrl} avatarName={avatarName} onAvatarFile={onAvatarFile} onAvatarPreset={onAvatarPreset} showOverlay={showOverlay} onShowOverlay={setShowOverlay} motion={motion} onMotion={setMotion} size={size} onSize={setSize} inVideo={inVideo} onInVideo={setInVideo} beside={beside} onBeside={setBeside} selfDelay={selfDelay} onSelfDelay={setSelfDelay} />}
              {tab === "cast" && <CastPanel lead={lead} cast={cast} beat={60 / bpm} cues={cues} onCues={setCues} transition={transition} onTransition={setTransition} time={time} total={stageDuration} placements={placements} onAdd={() => openModal("add")} onEditLead={() => setSettingsTab("dancer")} onLook={(id) => { setLookFor(id); openModal("look"); }} onDuplicate={duplicateCast} onRemove={removeCast} onUpdate={updateCast} />}
              {tab === "traces" && score && <>
                <Section title="Traces">
                  <Switch label="Movement trails" hint="Follow the traced joints through space." checked={objects.traces} onChange={(traces) => setObjects({ ...objects, traces })} />
                  <NumSlider label="Length" value={objects.trailSeconds} min={0.2} max={6} step={0.1} decimals={1} unit="s" disabled={!objects.traces || objects.whole} onChange={(trailSeconds) => setObjects({ ...objects, trailSeconds })} />
                  <Switch label="From the start" hint="Keep every trace since the beginning of the clip; the drawing grows as it plays." checked={objects.whole} disabled={!objects.traces} onChange={(whole) => setObjects({ ...objects, whole })} />
                  <Switch label="Alignments" hint="Highlight parallel and aligned limbs." checked={objects.alignments} onChange={(alignments) => setObjects({ ...objects, alignments })} />
                  <Switch label="Density" hint="Reveal the areas where movement gathers." checked={objects.density} onChange={(density) => setObjects({ ...objects, density })} />
                  <Switch label="Video plate" hint={analysis ? "Show the recording behind the traces." : "Available when you add a video."} checked={objects.video} disabled={!analysis} onChange={(video) => setObjects({ ...objects, video })} />
                  <NumSlider label="Dim" hint="How much the picture is darkened so the drawing reads." value={traceStyle.dim} min={0} max={1} step={0.05} decimals={2} disabled={!analysis || !objects.video} onChange={(dim) => setTraceStyle({ ...traceStyle, dim })} />
                  <Seg label="Ground" value={traceStyle.ground} onChange={(ground) => setTraceStyle({ ...traceStyle, ground })} options={[
                    { value: "night", label: "Night", hint: "Ink on black (when the video plate is off)." },
                    { value: "paper", label: "Paper", hint: "Ink on warm paper (when the video plate is off)." },
                  ]} />
                </Section>
                <Section title="Style" aside={<button className="insp-btn" onClick={() => setTraceStyle(DEFAULT_TRACE_STYLE)} disabled={traceStyle === DEFAULT_TRACE_STYLE}><RotateCcw size={11} /> Reset</button>}>
                  <div className="insp-presets">
                    {TRACE_PRESETS.map((p) => <button key={p.name} className="insp-btn" title={p.hint} onClick={() => setTraceStyle({ ...DEFAULT_TRACE_STYLE, ...p.style, dim: traceStyle.dim })}>{p.name}</button>)}
                  </div>
                  <Chips label="Traced joints" value={traceStyle.groups} onChange={(groups) => setTraceStyle({ ...traceStyle, groups })} options={TRACE_GROUPS.map((g) => ({ value: g.id, label: g.label }))} />
                  <Seg label="Colour" value={traceStyle.colour} onChange={(colour) => setTraceStyle({ ...traceStyle, colour })} options={[
                    { value: "sides", label: "Sides", hint: "Left side blue, right side pink, centre white." },
                    { value: "speed", label: "Speed", hint: "Cool when slow, hot when fast." },
                    { value: "time", label: "Time", hint: "The hue turns through the clip." },
                    { value: "ink", label: "Ink", hint: "One colour of your choosing." },
                  ]} />
                  {traceStyle.colour === "ink" && <Colour label="Ink" value={traceStyle.ink} onChange={(ink) => setTraceStyle({ ...traceStyle, ink })} />}
                  <Seg label="Stroke" value={traceStyle.mark} onChange={(mark) => setTraceStyle({ ...traceStyle, mark })} options={[
                    { value: "line", label: "Line", hint: "A continuous trail." },
                    { value: "dots", label: "Dots", hint: "One dot per frame." },
                  ]} />
                  <NumSlider label="Weight" value={traceStyle.weight} min={0.3} max={8} step={0.1} decimals={1} unit="px" onChange={(weight) => setTraceStyle({ ...traceStyle, weight })} />
                  <Switch label="Weight by speed" hint="Thicker where the joint moves fast, thinner where it lingers." checked={traceStyle.pulse} onChange={(pulse) => setTraceStyle({ ...traceStyle, pulse })} />
                  <Switch label="Smooth curves" hint="Bend the trail through the samples instead of joining them with straight lines." checked={traceStyle.curve} disabled={traceStyle.mark === "dots"} onChange={(curve) => setTraceStyle({ ...traceStyle, curve })} />
                  <NumSlider label="Glow" value={traceStyle.glow} min={0} max={1} step={0.05} decimals={2} onChange={(glow) => setTraceStyle({ ...traceStyle, glow })} />
                  <NumSlider label="Fade" hint="How much the tail of a trail fades out. 0 keeps everything." value={traceStyle.fade} min={0} max={1} step={0.05} decimals={2} onChange={(fade) => setTraceStyle({ ...traceStyle, fade })} />
                  <Seg label="Ribbons" value={traceStyle.ribbons} onChange={(ribbons) => setTraceStyle({ ...traceStyle, ribbons })} options={[
                    { value: "off", label: "None" },
                    { value: "pairs", label: "Pairs", hint: "A string between left and right: hand to hand, foot to foot." },
                    { value: "web", label: "Web", hint: "Strings between every traced joint." },
                  ]} />
                  <Switch label="Position dots" hint="A marker on each joint's current position." checked={traceStyle.dots} onChange={(dots) => setTraceStyle({ ...traceStyle, dots })} />
                </Section>
                <Section title="Whole phrase" aside={<button className="insp-btn" onClick={savePicture} title="Save what is on the plate now as a PNG"><ImageDown size={11} /> Save picture</button>}>
                  <div className="insp-drawing"><Drawing score={score} overlays={overlays} style={traceStyle} /></div>
                  <Note>Every trace of the clip at once, in the current style. The picture saved above is the plate as it stands: the playhead, the trails, the picture behind.</Note>
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
        {live && <footer className="studio-timeline"><LiveBar elapsed={time} keyframes={liveFrame?.keyframes ?? 0} ready={!!liveFrame} finishing={finishing} match={along ? { now: matchNow, mean: matchMean, over: time > along.target.source.duration + DEFAULT_MATCH.window } : null} onFinish={finishLive} onDiscard={discardLive} /></footer>}
        {score && !live && <footer className="studio-timeline"><Timeline score={score} total={stageDuration} time={time} playing={playing} onSeek={seek} onTogglePlay={togglePlay} onStep={step} selected={selected} onSelect={setSelected} speed={speed} onSpeed={setSpeed} loop={loop} onLoop={() => setLoop((l) => !l)} tempo={tempo} bpm={bpm} onBpm={onBpm} /></footer>}
      </>}

      <Dialog open={modal === "new"} title={busy ? "Creating your dance" : "Start a new dance"} description={busy ? "Your video is being processed on this device." : "A video, a recording, or a saved dance. Choose where to begin."} onClose={closeNew} locked={busy}>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <NewScore initialMode={newMode} onFile={onFile} onImport={importJson} onDemo={loadDemo} onLive={startLive} danceName={score && !live ? score.source.name.replace(/\.[^.]+$/, "") : null} busy={busy} progress={progress} loading={phase === "loading"} onCancel={cancelTracking} />
      </Dialog>
      <Dialog open={modal === "save"} title="Save your movement" description="Download a reusable copy of this dance." onClose={() => setModal(null)}>
        {score && <SaveScore key={score.source.name} score={score} onSave={exportJson} />}
      </Dialog>
      <Dialog open={modal === "details"} title="Read the movement" description="Directions for the current frame. Select a limb to highlight it on the stage." onClose={() => setModal(null)} wide>
        {snappedPose && rawPose && <><div className="notation-scroll"><BoneTable snapped={snappedPose} raw={rawPose} selected={selected} onSelect={(id) => { setSelected(id); setModal(null); setView((v) => (v === "video" || v === "objects" ? "score" : v)); }} /></div><p className="dialog-note">Grid: snapped angles. Laban: direction and level. E-W: Eshkol–Wachman units. Raw: the tracked angles before snapping.</p></>}
      </Dialog>
      <Dialog open={modal === "add"} title="Add a dancer" description="Who they are, and what they dance. They join the stage beside you, sharing the clock." onClose={() => { if (!addProgress) { setModal(null); setError(null); } }} locked={!!addProgress}>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <AddDancer hasDance={!!score} danceName={source ? source.name.replace(/\.[^.]+$/, "") : null} beat={60 / bpm} usedLooks={usedLooks} progress={addProgress} onAddThis={addThis} onAddFile={addFile} onAddSaved={addSaved} onAddExample={addExample} onCancel={cancelAdd} />
      </Dialog>
      <Dialog open={modal === "look"} title="Change the look" description={lookMember ? `${lookMember.name}, dancing ${lookMember.score.source.name.replace(/\.[^.]+$/, "")}.` : undefined} onClose={() => setModal(null)}>
        {lookMember && <div className="add-dancer">
          <CharacterGrid avatar={!!lookMember.avatarUrl} avatarUrl={lookMember.avatarUrl ?? DEFAULT_AVATAR_URL} avatarName={lookMember.avatarUrl?.startsWith("blob:") ? lookMember.name : null}
            onAvatar={(on) => setMemberLook(lookMember.id, on ? (lookMember.avatarUrl ?? DEFAULT_AVATAR_URL) : null)}
            onAvatarPreset={(url) => setMemberLook(lookMember.id, url)}
            onAvatarFile={(f) => setMemberLook(lookMember.id, URL.createObjectURL(f), f.name.replace(/\.vrm$/i, ""))} />
          <button className="btn primary dialog-primary" onClick={() => setModal(null)}>Done</button>
        </div>}
      </Dialog>
      <Dialog open={modal === "report"} title="How you did" description={report ? `Dancing along to ${report.dance}. The take is kept as a dance of its own.` : undefined} onClose={() => setModal(null)}>
        {report && <div className="along-report">
          <div className="along-score"><b>{Math.round(report.summary.score * 100)}%</b><span>{grade(report.summary.score)}</span></div>
          <div className="along-limbs">
            {CORE_BONES.map((id) => <div key={id}><span>{BONE[id].label}</span><i><b style={{ width: `${Math.round(report.summary.bones[id] * 100)}%` }} /></i><span>{Math.round(report.summary.bones[id] * 100)}%</span></div>)}
          </div>
          <div className="along-facts">
            <span><Target size={12} /> Longest run in step: {report.summary.streak.toFixed(1)} s</span>
            <span>{Math.abs(report.summary.lag) < 0.05 ? "Right on time" : report.summary.lag > 0 ? `You ran about ${report.summary.lag.toFixed(2)} s behind` : `You ran about ${(-report.summary.lag).toFixed(2)} s ahead`}</span>
            <span>{report.summary.frames} frames scored</span>
          </div>
          <button className="btn primary dialog-primary" onClick={() => setModal(null)}>Explore the take</button>
        </div>}
      </Dialog>
      <Dialog open={modal === "compare"} title="This view needs a video" description="This dance contains movement data, but no original recording." onClose={() => setModal(null)}>
        <div className="empty-dialog"><Film size={35} /><p>Create a dance from your own video to watch the recording and 3D dancer together.</p><button className="btn primary" onClick={() => openNew()}>Choose a video</button><button className="btn" onClick={() => setModal(null)}>Back to the stage</button></div>
      </Dialog>
      <Dialog open={modal === "help"} title="A quick tour" description="From a video to a movement you can explore." onClose={() => setModal(null)}>
        <div className="help-steps"><div><Film size={23} /><span><strong>1. Create a dance</strong><p>Choose or record a short video and tap Create dance, or go live and dance in front of the camera. Or open an example to try things out.</p></span></div><div><Box size={23} /><span><strong>2. Explore the phrase</strong><p>Press Play. Drag the dancer to rotate the view. Side by side shows your video next to the stage, Video puts the characters inside the recording, Stage is the 3D dancer alone, and Traces reveals movement paths.</p></span></div><div><SlidersHorizontal size={23} /><span><strong>3. Make it yours</strong><p>The panel on the right changes the dancer and the movement detail as you watch. Add dancer puts more people on the stage: a character doing this dance, a canon, another video, or a saved dance. Notation explains the selected frame. Save downloads the current dance.</p></span></div></div>
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
