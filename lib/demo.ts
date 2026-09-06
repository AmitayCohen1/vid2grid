import { DEFAULT_BODY } from "./fk";
import { DEFAULT_GRID } from "./grid";
import type { Pose } from "./pose";
import { DEFAULT_SMOOTH, snapPoses, type Score } from "./score";

export type DemoPhrase = "reach" | "turn" | "sway";
export const DEMO_PHRASES = [
  { id: "reach" as const, name: "Reach & release", detail: "An unfolding arm phrase", duration: "8 s" },
  { id: "turn" as const, name: "Around the axis", detail: "A study in facing and rotation", duration: "8 s" },
  { id: "sway" as const, name: "Weight & balance", detail: "A side-to-side movement study", duration: "8 s" },
];

/** Authored movement studies, not motion-capture data. Available entirely offline. */
export function createDemo(phrase: DemoPhrase = "reach"): Score {
  const fps = 30, duration = 8;
  const raw: Pose[] = Array.from({ length: fps * duration }, (_, i) => {
    const t = i / fps, phase = t / duration * Math.PI * 2;
    const wave = Math.sin(phase), lift = (1 - Math.cos(phase)) / 2;
    const sway = phrase === "sway" ? wave : wave * 0.15;
    return {
      t, facing: phrase === "turn" ? t / duration * 360 : sway * 12,
      x: sway * 0.28, z: 0, hipY: 0.86 - Math.abs(sway) * 0.045, conf: 1,
      bones: {
        torso: [sway > 0 ? 90 : 270, 90 - Math.abs(sway) * 10], shoulders: [90, 0], head: [0, 85],
        ruarm: [90 + wave * 25, -65 + lift * 125], rfarm: [75 + wave * 40, -45 + lift * 125], rhand: [90, -35 + lift * 100],
        luarm: [270 - wave * 25, -65 + lift * 100], lfarm: [285 - wave * 40, -45 + lift * 120], lhand: [270, -35 + lift * 100],
        rthigh: [90, -82 + sway * 7], rshin: [180, -87 + Math.abs(sway) * 5], rfoot: [0, -8],
        lthigh: [270, -82 - sway * 7], lshin: [180, -87 + Math.abs(sway) * 5], lfoot: [0, -8],
      },
    };
  });
  return {
    version: 1, source: { name: `${DEMO_PHRASES.find((p) => p.id === phrase)!.name} · example`, duration, fps, width: 1280, height: 720 },
    grid: { ...DEFAULT_GRID }, smooth: { ...DEFAULT_SMOOTH }, lift: "anchored", body: { ...DEFAULT_BODY, lengths: { ...DEFAULT_BODY.lengths } },
    raw, ...snapPoses(raw, DEFAULT_GRID),
  };
}
