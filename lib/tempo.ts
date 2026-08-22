/* ------------------------------------------------------------------
   Motion-derived tempo: autocorrelate a movement-intensity signal
   over plausible beat periods, then phase-align to the keyframes.
   An estimate, never an authority — the UI always allows override.
   ------------------------------------------------------------------ */

import { fromAzEl } from "./geometry";
import type { Pose } from "./pose";
import { SECTION_BONE_IDS } from "./sectionize";

export interface TempoEstimate { bpm: number; offsetSec: number; confidence: number }

export const FALLBACK: TempoEstimate = { bpm: 100, offsetSec: 0, confidence: 0 };
const BPM_MIN = 30, BPM_MAX = 200, BPM_STEP = 0.5;

/** Mean angular speed (deg/s) of the ten section bones, per frame. */
export function movementSignal(raw: Pose[], fps: number): number[] {
  const out = new Array<number>(raw.length).fill(0);
  for (let i = 1; i < raw.length; i++) {
    let sum = 0;
    for (const id of SECTION_BONE_IDS) {
      const a = fromAzEl(raw[i - 1].bones[id]), b = fromAzEl(raw[i].bones[id]);
      const d = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
      sum += (Math.acos(d) * 180) / Math.PI;
    }
    out[i] = (sum / SECTION_BONE_IDS.length) * fps;
  }
  return out;
}

/** Normalized autocorrelation at a (fractional) lag, linear-interpolated. */
function autocorr(s: number[], lag: number): number {
  const n = s.length;
  const i0 = Math.floor(lag), frac = lag - i0;
  let num = 0, den = 0;
  for (let i = 0; i + i0 + 1 < n; i++) {
    const lagged = s[i + i0] * (1 - frac) + s[i + i0 + 1] * frac;
    num += s[i] * lagged;
    den += s[i] * s[i];
  }
  return den > 1e-9 ? num / den : 0;
}

export function estimateTempo(raw: Pose[], keyframeTimes: number[], fps: number): TempoEstimate {
  if (raw.length < 3 * fps) return FALLBACK;
  const s0 = movementSignal(raw, fps);
  const mean = s0.reduce((a, b) => a + b, 0) / s0.length;
  const s = s0.map((v) => v - mean);
  if (Math.max(...s0) < 5) return FALLBACK;   // essentially still

  let bestBpm = 0, bestR = -Infinity;
  for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += BPM_STEP) {
    const lag = (fps * 60) / bpm;
    if (lag >= raw.length / 2) continue;
    const r = autocorr(s, lag) + 0.4 * autocorr(s, 2 * lag);
    if (r > bestR) { bestR = r; bestBpm = bpm; }
  }
  if (bestBpm === 0 || bestR < 0.1) return FALLBACK;

  // Phase: circular mean of keyframe times against the beat period.
  const period = 60 / bestBpm;
  let offsetSec = 0, align = 0;
  if (keyframeTimes.length >= 2) {
    let sx = 0, sy = 0;
    for (const t of keyframeTimes) { const a = (2 * Math.PI * t) / period; sx += Math.cos(a); sy += Math.sin(a); }
    offsetSec = ((Math.atan2(sy, sx) / (2 * Math.PI)) * period + period) % period;
    align = Math.hypot(sx, sy) / keyframeTimes.length;   // 0..1
  }
  const confidence = Math.max(0, Math.min(1, bestR)) * (0.5 + 0.5 * align);
  return { bpm: bestBpm, offsetSec: Math.round(offsetSec * 1000) / 1000, confidence: Math.round(confidence * 100) / 100 };
}
