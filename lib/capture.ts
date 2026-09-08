/* ------------------------------------------------------------------
   Live capture: a webcam, the tracker running on every displayed frame,
   and a recording of the take so the finished score keeps its video.

   The session clock starts when the recorder does, and every detection
   is stamped with it, so the frames line up with the recording later.
   Browser only (getUserMedia, MediaRecorder); no React.
   ------------------------------------------------------------------ */

import { LiveFollower } from "./follow";
import { type LiveFrame, type LiveSample, type LiveScore } from "./live";
import { extractPose } from "./pose";
import { type LiveDetector, liveDetector } from "./tracker";

/** Longest take, seconds — the same limit as an uploaded clip. */
export const LIVE_MAX_SECONDS = 120;

export interface LiveResult {
  /** The recording, when the browser could make one. */
  file: File | null;
  samples: LiveSample[];
  /** Seconds the take ran. */
  duration: number;
  /** Pixel size of the camera frame. */
  width: number;
  height: number;
}

export interface CaptureOptions {
  engine: LiveScore;
  /** Frames per second the take is later resampled to; also how long the follower waits before adopting someone new. */
  fps: number;
  /** Every displayed frame: what the stage should draw (null while warming up), the 2D landmarks, seconds since the start. */
  onFrame: (frame: LiveFrame | null, overlay: Float32Array | null, t: number) => void;
  /** The take reached its limit; the caller should finish it. */
  onLimit: () => void;
  onError: (e: unknown) => void;
}

/** The recording format this browser can make, best first. */
export function recorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export class LiveCapture {
  readonly engine: LiveScore;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private detector: LiveDetector | null = null;
  private follower: LiveFollower;
  private samples: LiveSample[] = [];
  private t0 = 0;
  private running = false;
  private handle = 0;
  private video: HTMLVideoElement | null = null;
  private limitHit = false;
  /** When the model last ran (ms), so the loop never asks for more than `fps` detections a second. */
  private lastDetect = -Infinity;

  constructor(private opts: CaptureOptions) {
    this.engine = opts.engine;
    this.follower = new LiveFollower(Math.round(opts.fps));
  }

  /** Ask for the camera. Resolves with the stream to show; rejects when there is none. */
  async open(): Promise<MediaStream> {
    const [stream, detector] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false }),
      liveDetector(),
    ]);
    this.stream = stream;
    this.detector = detector;
    // The first inference is by far the slowest (shaders compile, buffers
    // allocate); take it now, on a blank frame, rather than stalling the take.
    const warm = document.createElement("canvas");
    warm.width = 64; warm.height = 64;
    try { detector.detect(warm, 0); } catch { /* the real frames will tell */ }
    return stream;
  }

  /** Start tracking (and recording) the video element that shows the stream. Call once it has metadata. */
  run(video: HTMLVideoElement) {
    if (this.running || !this.stream || !this.detector) return;
    this.video = video;
    this.running = true;
    this.samples = [];
    this.chunks = [];
    const mime = recorderMime();
    try {
      const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
      rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      rec.start(250);
      this.recorder = rec;
    } catch {
      this.recorder = null; // tracking still works; the score just has no video
    }
    this.t0 = performance.now();
    this.schedule();
  }

  // Plain animation frames, not requestVideoFrameCallback: that only fires
  // while the video is painted, and on the 3D stage the camera pane is hidden.
  private schedule() {
    if (!this.video || !this.running) return;
    this.handle = requestAnimationFrame(() => { this.handle = 0; this.tick(); });
  }

  private tick() {
    const v = this.video;
    if (!v || !this.running || !this.detector) return;
    const t = (performance.now() - this.t0) / 1000;
    try {
      const now = performance.now();
      if (v.videoWidth && v.videoHeight && v.readyState >= 2 && now - this.lastDetect >= 1000 / this.opts.fps - 2) {
        this.lastDetect = now;
        const cands = this.detector.detect(v, t * 1000);
        const k = this.follower.pick(cands.map((c) => c.anchor));
        const c = k >= 0 ? cands[k] : null;
        const extraction = c ? extractPose(c.world, c.image, t, v.videoWidth / v.videoHeight) : null;
        const image = c?.buf ?? null;
        this.samples.push({ t, extraction, image });
        this.opts.onFrame(this.engine.push(extraction, t), image, t);
      }
    } catch (e) {
      this.running = false;
      this.opts.onError(e);
      return;
    }
    if (t >= LIVE_MAX_SECONDS && !this.limitHit) { this.limitHit = true; this.opts.onLimit(); return; }
    this.schedule();
  }

  /** Seconds since the take started. */
  get elapsed() { return this.running ? (performance.now() - this.t0) / 1000 : 0; }

  private stopLoop() {
    this.running = false;
    if (this.handle) cancelAnimationFrame(this.handle);
    this.handle = 0;
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
  }

  /** End the take: stop everything and hand back what was captured. */
  async stop(): Promise<LiveResult> {
    const duration = (performance.now() - this.t0) / 1000;
    const width = this.video?.videoWidth ?? 0, height = this.video?.videoHeight ?? 0;
    this.stopLoop();
    const file = await this.finishRecording();
    this.release();
    return { file, samples: this.samples, duration, width, height };
  }

  private finishRecording(): Promise<File | null> {
    const rec = this.recorder;
    this.recorder = null;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      rec.onstop = () => {
        clearTimeout(timeout);
        const type = rec.mimeType || "video/webm";
        const ext = type.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(this.chunks, { type });
        resolve(blob.size ? new File([blob], `live-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`, { type }) : null);
      };
      try { rec.stop(); } catch { clearTimeout(timeout); resolve(null); }
    });
  }

  /** Throw the take away. */
  cancel() {
    this.stopLoop();
    const rec = this.recorder;
    this.recorder = null;
    if (rec && rec.state !== "inactive") { rec.onstop = null; try { rec.stop(); } catch { /* already gone */ } }
    this.release();
  }
}
