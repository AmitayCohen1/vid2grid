/* ------------------------------------------------------------------
   Tracking: drive MediaPipe Pose Landmarker over a video file at a
   fixed sample rate by seeking, and collect one Extraction per frame.
   Runs entirely in the browser.
   ------------------------------------------------------------------ */

import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { extractPose, type Extraction, type Landmark } from "./pose";

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
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
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
          numPoses: 1,
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
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, frame: TrackedFrame) => void;
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

/** Run the tracker over the whole video. Frames with no person yield `extraction: null`. */
export async function trackVideo(video: HTMLVideoElement, opts: TrackOptions): Promise<TrackedFrame[]> {
  const lm = await getLandmarker();
  const duration = video.duration;
  const total = Math.max(1, Math.floor(duration * opts.fps));
  const aspect = video.videoWidth / video.videoHeight;
  const out: TrackedFrame[] = [];
  const base = clock + 1;
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const t = Math.min(duration - 1e-3, i / opts.fps);
    await seek(video, t, opts.signal);
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const ts = Math.max(base + Math.round(t * 1000), clock + 1);
    clock = ts;
    const res = lm.detectForVideo(video, ts);
    let frame: TrackedFrame = { extraction: null, image: null };
    if (res.worldLandmarks.length && res.landmarks.length) {
      const world = res.worldLandmarks[0] as Landmark[];
      const image = res.landmarks[0] as Landmark[];
      const buf = new Float32Array(image.length * 3);
      image.forEach((p, k) => { buf[k * 3] = p.x; buf[k * 3 + 1] = p.y; buf[k * 3 + 2] = p.visibility ?? 0; });
      frame = { extraction: extractPose(world, image, t, aspect), image: buf };
    }
    out.push(frame);
    opts.onProgress?.(i + 1, total, frame);
  }
  return out;
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
