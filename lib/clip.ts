/* ------------------------------------------------------------------
   Getting a clip tracked when it is not the one on screen.

   The studio's own clip plays in the Compare pane and is tracked from
   that <video>. A dancer added from *another* video has no pane: a
   hidden <video> decodes it for the tracker, and the result is an
   ordinary analysis (frames + source) the cast can carry.
   ------------------------------------------------------------------ */

import { type Crop, cropPixels } from "./crop";
import type { PersonPick } from "./follow";
import type { SourceInfo } from "./score";
import { getLandmarker, trackPeople, type TrackedFrame } from "./tracker";

export interface Analysis {
  tracked: TrackedFrame[];
  source: SourceInfo;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/**
 * Where a second person tracked from the same clip stands relative to the
 * first, in stage metres: the difference of their typical positions. Every
 * dance is centred on its own typical position when smoothed (see
 * smoothPoses), so this is what puts two people from one clip back where
 * they were beside each other.
 */
export function offsetBetween(lead: TrackedFrame[], other: TrackedFrame[]): { x: number; z: number } {
  const at = (frames: TrackedFrame[]) => {
    const poses = frames.flatMap((f) => (f.extraction ? [f.extraction.pose] : []));
    return { x: median(poses.map((p) => p.x)), z: median(poses.map((p) => p.z)) };
  };
  const a = at(lead), b = at(other);
  const round = (n: number) => Math.round(n * 100) / 100;
  return { x: round(b.x - a.x), z: round(b.z - a.z) };
}

export const MIN_CLIP = 1, MAX_CLIP = 120;

/** The clip-length rule, in the user's words. */
export function checkDuration(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < MIN_CLIP || seconds > MAX_CLIP) {
    throw new Error("Choose a clip between 1 and 120 seconds. A 5–30 second phrase works best.");
  }
}

/** Why nothing was tracked, given how the clip was framed. */
export function nobodyFound(picked: boolean, cropped: boolean): Error {
  return new Error(picked ? "The dancer you chose was never seen clearly. Pick them again on a frame where their whole body is in view."
    : cropped ? "No person detected inside the framed region. Try a wider crop, or Fit to dancer."
    : "No person detected in this clip. Try a clip with your whole body in frame.");
}

/** MediaRecorder webm files report an Infinite duration until seeked past the end; make it resolve. */
export function resolveDuration(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
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

function loadMetadata(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { video.removeEventListener("loadedmetadata", ok); video.removeEventListener("error", bad); signal?.removeEventListener("abort", aborted); };
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error("This video could not be decoded. Try an MP4 or WebM clip.")); };
    const aborted = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    if (video.readyState >= 1) { resolve(); return; }
    video.addEventListener("loadedmetadata", ok);
    video.addEventListener("error", bad);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

export interface TrackFileOptions {
  fps: number;
  crop?: Crop;
  /** People to follow, one dancer each; the biggest body when empty. */
  follow?: PersonPick[];
  signal?: AbortSignal;
  /** Called once the tracker is loaded and frames start being read. */
  onTracking?: () => void;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Track a video file off screen. Same pipeline as the studio's clip —
 * duration rule, crop, people to follow — with nothing shown. One
 * analysis per dancer followed (at least one).
 */
export async function trackFile(file: File, opts: TrackFileOptions): Promise<Analysis[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  // In the document, but as good as invisible, so no browser treats it as a
  // background video and holds back its decoding.
  video.setAttribute("aria-hidden", "true");
  Object.assign(video.style, { position: "fixed", left: "0", bottom: "0", width: "2px", height: "2px", opacity: "0.01", pointerEvents: "none" });
  document.body.appendChild(video);
  try {
    await loadMetadata(video, opts.signal);
    if (!Number.isFinite(video.duration)) await resolveDuration(video, opts.signal);
    checkDuration(video.duration);
    await getLandmarker();
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    opts.onTracking?.();
    const people = await trackPeople(video, {
      fps: opts.fps, crop: opts.crop, follow: opts.follow, signal: opts.signal,
      onProgress: (done, total) => opts.onProgress?.(done, total),
    });
    const seen = people.filter((tracked) => tracked.some((f) => f.extraction));
    if (!seen.length) throw nobodyFound(!!opts.follow?.length, !!opts.crop);
    const px = opts.crop ? cropPixels(opts.crop, video.videoWidth, video.videoHeight) : { w: video.videoWidth, h: video.videoHeight };
    const source: SourceInfo = { name: file.name, duration: video.duration, fps: opts.fps, width: px.w, height: px.h, crop: opts.crop };
    return seen.map((tracked) => ({ tracked, source }));
  } finally {
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}
