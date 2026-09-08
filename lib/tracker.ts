/* ------------------------------------------------------------------
   Tracking: drive MediaPipe Pose Landmarker over a video file at a
   fixed sample rate by seeking, and collect one Extraction per frame.
   Runs entirely in the browser.
   ------------------------------------------------------------------ */

import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { extractPose, type Extraction, type Landmark } from "./pose";
import { type Crop, FULL_CROP, cropPixels, fitCropToPoints, isFullCrop } from "./crop";
import { type Anchor, type PersonPick, anchorOf, dedupeAnchors, followPerson, largestAnchor, locatePick } from "./follow";

/**
 * How many people the model looks for per frame. Every one of them is a
 * candidate for *the dancer* (see ./follow); a solo clip costs nothing extra.
 */
export const MAX_PEOPLE = 4;

let landmarkerPromise: Promise<PoseLandmarker> | null = null;
/** MediaPipe demands strictly increasing timestamps for the life of the graph, across clips. */
let clock = 0;

export function getLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      let vision;
      try {
        vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      } catch (e) {
        // MediaPipe rejects with a DOM Event here, which stringifies to the
        // useless "[object Event]"; surface the likely cause instead.
        throw new Error("Couldn't load the tracking runtime from /mediapipe/wasm. Reload the page; if it persists the tracking assets are missing — run `npm install` (its postinstall restores them).", { cause: e });
      }
      try {
        return await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/models/pose_landmarker_full.task", delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: MAX_PEOPLE,
          minPoseDetectionConfidence: 0.4,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch {
        // GPU delegate unavailable — fall back to CPU.
      }
      try {
        return await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/models/pose_landmarker_full.task", delegate: "CPU" },
          runningMode: "VIDEO",
          numPoses: MAX_PEOPLE,
        });
      } catch (e) {
        throw new Error("Couldn't load the pose model from /models/pose_landmarker_full.task. Reload the page; if it persists the model file is missing — run `npm install` (its postinstall downloads it).", { cause: e });
      }
    })();
    landmarkerPromise.catch(() => (landmarkerPromise = null));
  }
  return landmarkerPromise;
}

export interface TrackedFrame {
  extraction: Extraction | null;
  /** Normalised 2D landmarks for the overlay (x, y, visibility per landmark). */
  image: Float32Array | null;
}

export interface TrackOptions {
  fps: number;
  /** Region of the frame to track (fractions); the rest of the frame is never seen. Default: the whole frame. */
  crop?: Crop;
  /** Who to follow when several people are in frame, as a tap on the full frame. Default: the biggest body. */
  follow?: PersonPick;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, frame: TrackedFrame) => void;
}

/** Longest side of the frame handed to the model; the model itself works at 256 px. */
const MAX_FRAME_SIDE = 1280;

/**
 * What the model sees: the video itself for a full-frame crop, otherwise a
 * canvas the crop is painted into each frame. Either way `width`/`height`
 * are the dimensions the image landmarks are normalised against.
 */
function frameSource(video: HTMLVideoElement, crop: Crop) {
  if (isFullCrop(crop)) {
    return { width: video.videoWidth, height: video.videoHeight, grab: () => video as HTMLVideoElement | HTMLCanvasElement };
  }
  const px = cropPixels(crop, video.videoWidth, video.videoHeight);
  const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(px.w, px.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(px.w * scale));
  canvas.height = Math.max(1, Math.round(px.h * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
  return {
    width: canvas.width,
    height: canvas.height,
    grab: () => { ctx.drawImage(video, px.x, px.y, px.w, px.h, 0, 0, canvas.width, canvas.height); return canvas; },
  };
}

function landmarksToBuffer(image: Landmark[]): Float32Array {
  const buf = new Float32Array(image.length * 3);
  image.forEach((p, k) => { buf[k * 3] = p.x; buf[k * 3 + 1] = p.y; buf[k * 3 + 2] = p.visibility ?? 0; });
  return buf;
}

function seek(video: HTMLVideoElement, t: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
    if (Math.abs(video.currentTime - t) < 1e-5 && video.readyState >= 2) { resolve(); return; }
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("video seek failed")); };
    const onAbort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("The video stopped responding. Try a shorter MP4 clip.")); }, 10000);
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    video.currentTime = t;
  });
}

/** Everyone the model found on one frame, each person once. */
interface Candidate {
  world: Landmark[];
  image: Landmark[];
  buf: Float32Array;
  anchor: Anchor | null;
}

function candidatesOf(res: { landmarks: unknown[]; worldLandmarks: unknown[] }): Candidate[] {
  const out: Candidate[] = [];
  for (let k = 0; k < Math.min(res.landmarks.length, res.worldLandmarks.length); k++) {
    const image = res.landmarks[k] as Landmark[];
    const buf = landmarksToBuffer(image);
    out.push({ world: res.worldLandmarks[k] as Landmark[], image, buf, anchor: anchorOf(buf) });
  }
  return dedupeAnchors(out.map((c) => c.anchor)).map((k) => out[k]);
}

/** A pick on the full frame, expressed in the crop's coordinates (may fall outside 0..1 when the pick is outside the crop). */
function pickInCrop(pick: PersonPick, crop: Crop): PersonPick {
  return { x: (pick.x - crop.x) / crop.w, y: (pick.y - crop.y) / crop.h, t: pick.t };
}

/**
 * Decide who the dancer is on every frame: the person under the pick
 * (followed forwards and backwards from that moment), or, with no pick,
 * the biggest body on the first frame with anyone in it, followed from
 * there. Returns the chosen candidate index per frame, -1 for none.
 */
function chooseDancer(frames: Candidate[][], fps: number, pick?: PersonPick): number[] {
  const anchors = frames.map((f) => f.map((c) => c.anchor));
  if (pick) {
    const frame = Math.max(0, Math.min(frames.length - 1, Math.round(pick.t * fps)));
    const start = locatePick(anchors, pick, frame, Math.ceil(fps / 2));
    if (!start) throw new Error("Couldn't find the dancer you chose at that moment. Pick them again on a frame where their whole body is clear, or widen the crop.");
    return followPerson(anchors, start);
  }
  const frame = anchors.findIndex((a) => largestAnchor(a) >= 0);
  if (frame < 0) return frames.map(() => -1);
  // No pick: the main person. Lost for a second, we take whoever is biggest now.
  return followPerson(anchors, { frame, index: largestAnchor(anchors[frame]) }, { reseedAfter: Math.round(fps) });
}

/**
 * Run the tracker over the whole video. Every frame is detected first
 * (everyone in it), then one person is followed through them — so a pick
 * made mid-clip carries backwards to the start. Frames where the dancer
 * was not seen yield `extraction: null`.
 */
export async function trackVideo(video: HTMLVideoElement, opts: TrackOptions): Promise<TrackedFrame[]> {
  const lm = await getLandmarker();
  const duration = video.duration;
  const total = Math.max(1, Math.floor(duration * opts.fps));
  const crop = opts.crop ?? FULL_CROP;
  const src = frameSource(video, crop);
  const aspect = src.width / src.height;
  const frames: Candidate[][] = [];
  const times: number[] = [];
  const base = clock + 1;
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const t = Math.min(duration - 1e-3, i / opts.fps);
    await seek(video, t, opts.signal);
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const ts = Math.max(base + Math.round(t * 1000), clock + 1);
    clock = ts;
    const found = candidatesOf(lm.detectForVideo(src.grab(), ts));
    frames.push(found);
    times.push(t);
    // Progress shows whoever is biggest for now; identity is settled once every frame is in.
    const big = largestAnchor(found.map((c) => c.anchor));
    const c = big >= 0 ? found[big] : null;
    opts.onProgress?.(i + 1, total, c ? { extraction: extractPose(c.world, c.image, t, aspect), image: c.buf } : { extraction: null, image: null });
  }
  const chosen = chooseDancer(frames, opts.fps, opts.follow && pickInCrop(opts.follow, crop));
  return frames.map((found, i) => {
    const c = chosen[i] >= 0 ? found[chosen[i]] : null;
    return c ? { extraction: extractPose(c.world, c.image, times[i], aspect), image: c.buf } : { extraction: null, image: null };
  });
}

/**
 * Everyone in the video's current frame, as image-landmark buffers
 * normalised to the full frame — for choosing who to follow. The video
 * should be paused on the frame of interest.
 */
export async function detectPeople(video: HTMLVideoElement): Promise<Float32Array[]> {
  const lm = await getLandmarker();
  clock += 1;
  return candidatesOf(lm.detectForVideo(video, clock)).map((c) => c.buf);
}

/** Fill gaps where nobody was detected by holding the last good pose. */
export function fillGaps(frames: TrackedFrame[], fps: number): Extraction[] {
  const out: Extraction[] = [];
  // Backfill the leading gap so every source frame keeps its original index.
  let last: Extraction | null = frames.find((f) => f.extraction)?.extraction ?? null;
  for (let i = 0; i < frames.length; i++) {
    const e = frames[i].extraction;
    if (e) last = e;
    if (last) out.push({ ...last, pose: { ...last.pose, t: i / fps, conf: e ? last.pose.conf : 0 } });
  }
  return out;
}

/**
 * Find the dancer: detect on frames spread over the clip and return a crop
 * around everywhere they were seen, padded so a stretched arm still fits.
 * With a pick, the picked person is followed through the samples (taken
 * densely enough to keep hold of them); without one, the biggest body on
 * each sample counts. Null when nobody was found.
 */
export async function fitCropToDancer(video: HTMLVideoElement, opts: { follow?: PersonPick; samples?: number; margin?: number; signal?: AbortSignal } = {}): Promise<Crop | null> {
  const lm = await getLandmarker();
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const samples = Math.max(1, opts.samples ?? (opts.follow ? Math.min(240, Math.ceil(duration * FIT_FOLLOW_FPS)) : 8));
  const fps = samples / Math.max(duration, 1e-3);
  const wasPlaying = !video.paused;
  const t0 = video.currentTime;
  video.pause();
  const frames: Candidate[][] = [];
  try {
    for (let i = 0; i < samples; i++) {
      const t = Math.min(Math.max(0, duration - 1e-3), duration * (i + 0.5) / samples);
      await seek(video, t, opts.signal);
      if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      clock += 1;
      frames.push(candidatesOf(lm.detectForVideo(video, clock)));
    }
  } finally {
    if (!opts.signal?.aborted) {
      await seek(video, t0).catch(() => {});
      if (wasPlaying) void video.play().catch(() => {});
    }
  }
  const seen: number[] = [];
  if (opts.follow) {
    const anchors = frames.map((f) => f.map((c) => c.anchor));
    // Samples sit at (i + 0.5) / fps, so the one nearest the pick is floor(t * fps).
    const start = locatePick(anchors, opts.follow, Math.max(0, Math.min(samples - 1, Math.floor(opts.follow.t * fps))), 2);
    if (!start) return null;
    followPerson(anchors, start).forEach((k, i) => { if (k >= 0) seen.push(...frames[i][k].buf); });
  } else {
    for (const f of frames) {
      const big = largestAnchor(f.map((c) => c.anchor));
      if (big >= 0) seen.push(...f[big].buf);
    }
  }
  return fitCropToPoints(seen, opts.margin ?? 0.2);
}

/** Sample rate for following a picked person while fitting the crop; sparser and a fast dancer outruns the jump limit. */
const FIT_FOLLOW_FPS = 4;
