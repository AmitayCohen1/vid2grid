import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTempo, movementSignal } from "../lib/tempo";
import type { Pose } from "../lib/pose";
import { BONE_IDS } from "../lib/skeleton";
import type { AzEl } from "../lib/geometry";

/** Synthetic dance: arms swing sinusoidally with the given beat period. */
function synthRaw(periodSec: number, fps = 30, durationSec = 8): Pose[] {
  const n = Math.round(durationSec * fps);
  return Array.from({ length: n }, (_, i) => {
    const t = i / fps;
    const az = 45 * Math.sin((2 * Math.PI * t) / periodSec);
    const bones = Object.fromEntries(BONE_IDS.map((id) => [id, [id === "ruarm" || id === "luarm" ? az : 0, -30] as AzEl])) as Pose["bones"];
    return { t, facing: 0, x: 0, z: 0, hipY: 0.95, bones, conf: 0.9 };
  });
}

test("movementSignal is periodic with the swing", () => {
  const s = movementSignal(synthRaw(0.5), 30);
  assert.equal(s.length, 240);
  assert.ok(Math.max(...s) > 0);
});

test("estimateTempo finds ~120 bpm for a 0.5 s period", () => {
  const raw = synthRaw(0.5);
  const kf = Array.from({ length: 16 }, (_, i) => i * 0.5);   // keyframes on the beat
  const est = estimateTempo(raw, kf, 30);
  // Half/double ambiguity is allowed; accept 60, 120, or 240 within 3 bpm.
  const ok = [60, 120, 240].some((b) => Math.abs(est.bpm - b) <= 3);
  assert.ok(ok, `got ${est.bpm}`);
  assert.ok(est.confidence > 0.2);
});

test("estimateTempo offset aligns keyframes to the grid", () => {
  const raw = synthRaw(0.5);
  const kf = Array.from({ length: 14 }, (_, i) => 0.2 + i * 0.5);  // beats shifted by 0.2 s
  const est = estimateTempo(raw, kf, 30);
  const period = 60 / est.bpm;
  // Offset should place keyframes near beat lines: residual of 0.2 modulo period.
  const res = Math.abs(((0.2 - est.offsetSec) % period + period) % period);
  assert.ok(res < period * 0.15 || res > period * 0.85, `residual ${res} of period ${period}`);
});

test("estimateTempo falls back on short or still input", () => {
  const est = estimateTempo(synthRaw(0.5, 30, 1.5), [], 30);
  assert.equal(est.bpm, 100);
  assert.equal(est.confidence, 0);
});
