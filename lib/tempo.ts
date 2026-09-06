/* ------------------------------------------------------------------
   Motion-derived tempo: autocorrelate a movement-intensity signal
   over plausible beat periods, then phase-align to the keyframes.
   An estimate, never an authority — the UI always allows override.
   ------------------------------------------------------------------ */

import { fromAzEl } from "./geometry";
import type { Pose } from "./pose";
import { BONES } from "./skeleton";

/** The segments the notations record — the same rows as the grid roll. */
const TEMPO_BONES = BONES.filter((b) => b.core).map((b) => b.id);

export interface TempoEstimate { bpm: number; offsetSec: number; confidence: number }

export const FALLBACK: TempoEstimate = { bpm: 100, offsetSec: 0, confidence: 0 };
const BPM_MIN = 30, BPM_MAX = 200, BPM_STEP = 0.5;

/** Mean angular speed (deg/s) of the ten section bones, per frame. */
export function movementSignal(raw: Pose[], fps: number): number[] {
  const out = new Array<number>(raw.length).fill(0);
  for (let i = 1; i < raw.length; i++) {
    let sum = 0;
    for (const id of TEMPO_BONES) {
      const a = fromAzEl(raw[i - 1].bones[id]), b = fromAzEl(raw[i].bones[id]);
      const d = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
      sum += (Math.acos(d) * 180) / Math.PI;
    }
    out[i] = (sum / TEMPO_BONES.length) * fps;
  }
  return out;
}

/** Normalized autocorrelation at a (fractional) lag, linear-interpolated.
    Symmetric normalization over the overlap window keeps scores across
    different lags comparable on non-stationary signals; result in [-1, 1]. */
function autocorr(s: number[], lag: number): number {
  const n = s.length;
  const i0 = Math.floor(lag), frac = lag - i0;
  let num = 0, e0 = 0, e1 = 0;
  for (let i = 0; i + i0 + 1 < n; i++) {
    const lagged = s[i + i0] * (1 - frac) + s[i + i0 + 1] * frac;
    num += s[i] * lagged;
    e0 += s[i] * s[i];
    e1 += lagged * lagged;
  }
  const den = Math.sqrt(e0 * e1);
  return den > 1e-9 ? num / den : 0;
}

export function estimateTempo(raw: Pose[], keyframeTimes: number[], fps: number): TempoEstimate {
  if (raw.length < 3 * fps) return FALLBACK;
  const s0 = movementSignal(raw, fps);
  const mean = s0.reduce((a, b) => a + b, 0) / s0.length;
  const s = s0.map((v) => v - mean);
  let mx = 0;
  for (const v of s0) if (v > mx) mx = v;
  if (mx < 5) return FALLBACK;   // essentially still

  // Autocorrelation across the plausible range. A smooth, unpulsed clip
  // correlates highly at *every* short lag, so a high score on its own is no
  // evidence of a beat — the peak has to be a local maximum (a real period)
  // that stands proud of the rest of the curve. Without that guard the search
  // just slides to the fastest tempo in range and reports it confidently.
  const bpms: number[] = [], rs: number[] = [];
  for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += BPM_STEP) {
    const lag = (fps * 60) / bpm;
    if (lag >= raw.length / 2) continue;
    bpms.push(bpm);
    rs.push(autocorr(s, lag) + 0.4 * autocorr(s, 2 * lag));
  }
  if (rs.length < 3) return FALLBACK;
  const baseline = rs.reduce((a, b) => a + b, 0) / rs.length;
  let bestBpm = 0, bestR = 0, prominence = 0;
  for (let i = 1; i < rs.length - 1; i++) {
    if (!(rs[i] > rs[i - 1] && rs[i] >= rs[i + 1])) continue;   // interior peaks only
    const p = rs[i] - baseline;
    if (p > prominence) { prominence = p; bestBpm = bpms[i]; bestR = rs[i]; }
  }
  if (bestBpm === 0 || prominence < 0.05 || bestR < 0.1) return FALLBACK;

  // Phase: circular mean of keyframe times against the beat period.
  const period = 60 / bestBpm;
  let offsetSec = 0, align = 0;
  if (keyframeTimes.length >= 2) {
    let sx = 0, sy = 0;
    for (const t of keyframeTimes) { const a = (2 * Math.PI * t) / period; sx += Math.cos(a); sy += Math.sin(a); }
    offsetSec = ((Math.atan2(sy, sx) / (2 * Math.PI)) * period + period) % period;
    align = Math.hypot(sx, sy) / keyframeTimes.length;   // 0..1
  }
  // Prominence, not raw correlation, is what says "there is a pulse here".
  const confidence = Math.max(0, Math.min(1, prominence * 3)) * (0.5 + 0.5 * align);
  return { bpm: bestBpm, offsetSec: Math.round(offsetSec * 1000) / 1000, confidence: Math.round(confidence * 100) / 100 };
}
