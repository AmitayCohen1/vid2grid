/* ------------------------------------------------------------------
   Recorded examples: real clips that open instantly.

   A saved dance (.vid2grid.json) carries the movement but not the
   video or the per-frame tracking, so opening it can't show the clip.
   A recorded example ships all three — the clip, its tracking and a
   poster — so the studio opens it exactly as if it had just been
   tracked, without tracking it again.

   To add one: put the clip in public/examples/<id>.mp4, run the studio
   locally with ?examples, track the clip and press Save — the tracking
   is written to public/examples/<id>.tracking.json (app/api/dev-example).
   Add a poster (<id>.jpg) and list it below.
   ------------------------------------------------------------------ */

import type { Analysis } from "./clip";
import type { TrackedFrame } from "./tracker";

export interface RecordedExample {
  id: string;
  name: string;
  detail: string;
  duration: string;
  video: string;
  tracking: string;
  poster: string;
}

const at = (id: string) => ({ video: `/examples/${id}.mp4`, tracking: `/examples/${id}.tracking.json`, poster: `/examples/${id}.jpg` });

export const RECORDED_EXAMPLES: RecordedExample[] = [
  { id: "gal-apartment", name: "Gal at home", detail: "Gal Gorfung dancing in his living room", duration: "15 s", ...at("gal-apartment") },
  // Tracked locally (public/examples/spider.*, solo.*) but not shipped: the clips are other artists' YouTube videos.
  // { id: "spider", name: "The Spider", detail: "Milena Sidorova on stage", duration: "15 s", ...at("spider") },
  // { id: "solo", name: "Solo improvisation", detail: "Yin Yue in a dark studio", duration: "15 s", ...at("solo") },
];

/** True when the studio was opened with ?examples — Save then writes the tracking to public/examples/. */
export const exportingExamples = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("examples");

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const pack = (a: Float32Array | null | undefined) => (a ? Array.from(a, round) : null);

export function serializeAnalysis(a: Analysis): string {
  return JSON.stringify({
    v: 1,
    source: a.source,
    tracked: a.tracked.map((f) => ({
      image: pack(f.image),
      extraction: f.extraction && { ...f.extraction, evidence: f.extraction.evidence && { data: pack(f.extraction.evidence.data) } },
    })),
  });
}

type Packed = { image: number[] | null; extraction: (Omit<NonNullable<TrackedFrame["extraction"]>, "evidence"> & { evidence?: { data: number[] | null } }) | null };

export function parseAnalysis(text: string): Analysis {
  const d = JSON.parse(text) as { v: number; source: Analysis["source"]; tracked: Packed[] };
  if (d.v !== 1 || !Array.isArray(d.tracked)) throw new Error("This example's tracking file is not one the studio can read.");
  return {
    source: d.source,
    tracked: d.tracked.map((f) => ({
      image: f.image ? Float32Array.from(f.image) : null,
      extraction: f.extraction && {
        ...f.extraction,
        evidence: f.extraction.evidence?.data ? { data: Float32Array.from(f.extraction.evidence.data) } : undefined,
      },
    })),
  };
}

/* ------------------------------------------------------------------
   Scenes: a recorded example set up a particular way, each with its own
   link (/example/<id>) so it can be shown directly — a solo, a group in
   unison, a canon, the traces. Dancers are named by their character.
   ------------------------------------------------------------------ */

export type SceneView = "both" | "video" | "score" | "objects";

export interface Scene {
  title: string;
  /** One line for the index page. */
  detail: string;
  example: string;
  view: SceneView;
  /** The lead's character (default: the skeleton). The video view draws only the lead. */
  lead?: string;
  /** How far beside the person the character stands in the video, metres (+ right). */
  beside?: number;
  /** Extra dancers doing the same dance: character label and entrance in beats after the lead,
      plus the choreographic devices — speed, mirror, retrograde, scale. */
  dancers: { character: string; beats: number; rate?: number; mirror?: boolean; reverse?: boolean; size?: number }[];
  /** Formations over the stage clock: seconds, shape, metres between neighbours, facing. */
  formations?: { at: number; shape: "line" | "column" | "diagonal" | "vee" | "circle" | "pairs" | "cluster"; spacing?: number; facing?: "audience" | "centre" | "outward" }[];
  motion?: "stepped" | "smooth";
  kinesphere?: boolean;
  /** Notation grid, degrees per step. */
  gridStep?: number;
  /** Traces: draw the whole phrase instead of a short trail. */
  wholeTrace?: boolean;
}

const many = (characters: string[], beats: (i: number) => number) => characters.map((character, i) => ({ character, beats: beats(i) }));

export const SCENES = {
  solo: { title: "Solo", detail: "Gal's video beside the 3D figure his movement drives.", example: "gal-apartment", view: "both", dancers: [] },
  group: { title: "Group", detail: "Three more dancers take his phrase, all in unison.", example: "gal-apartment", view: "score", dancers: [{ character: "Vivi", beats: 0 }, { character: "Mannequin", beats: 0 }, { character: "Ren", beats: 0 }] },
  canon: { title: "Canon", detail: "The same phrase, entering one beat after another.", example: "gal-apartment", view: "score", dancers: [{ character: "Neon", beats: 1 }, { character: "Kai", beats: 2 }, { character: "Sapphire", beats: 3 }] },
  traces: { title: "Traces", detail: "The paths his joints draw through space.", example: "gal-apartment", view: "objects", dancers: [] },
  video: { title: "In the video", detail: "A character dancing his phrase, inside his living room.", example: "gal-apartment", view: "video", lead: "Vivi", beside: 0.28, dancers: [] },
  mirror: { title: "Mirror", detail: "Left and right swapped: a partner dancing his mirror image.", example: "gal-apartment", view: "score", dancers: [{ character: "Ivy", beats: 0, mirror: true }] },
  backwards: { title: "Backwards", detail: "Retrograde: the same phrase, danced from its end to its start.", example: "gal-apartment", view: "score", dancers: [{ character: "Ren", beats: 0, reverse: true }] },
  tempo: { title: "Fast & slow", detail: "One dancer at double speed, one at half — the phrase stretched and squeezed.", example: "gal-apartment", view: "score", dancers: [{ character: "Mizu", beats: 0, rate: 2 }, { character: "Kai", beats: 0, rate: 0.5 }] },
  circle: { title: "Circle", detail: "Seven dancers in a ring, facing in, all on the same breath.", example: "gal-apartment", view: "score", dancers: many(["Hikari", "Neon", "Kai", "Vivi", "Ren", "Sora"], () => 0), formations: [{ at: 0, shape: "circle", spacing: 1.3, facing: "centre" }] },
  formations: { title: "Formations", detail: "A line, then a V, then a circle — the dancers walk between them.", example: "gal-apartment", view: "score", dancers: many(["Mannequin", "Ebony", "Hikari", "Neon"], () => 0), formations: [{ at: 0, shape: "line", spacing: 1.2 }, { at: 5, shape: "vee", spacing: 1.2 }, { at: 10, shape: "circle", spacing: 1.3, facing: "centre" }] },
  scale: { title: "Giant & small", detail: "The same dance, larger than life and half his size.", example: "gal-apartment", view: "score", dancers: [{ character: "Mannequin", beats: 0, size: 1.35 }, { character: "Ebony", beats: 0, size: 0.5 }] },
  echo: { title: "Echo", detail: "Glass figures trailing him half a beat apart, like after-images.", example: "gal-apartment", view: "score", dancers: many(["Glass", "Sapphire", "Glass", "Sapphire"], (i) => (i + 1) * 0.5), formations: [{ at: 0, shape: "column", spacing: 0.6 }] },
  wave: { title: "Wave", detail: "Eight dancers in two lines, each a quarter beat after the last.", example: "gal-apartment", view: "score", dancers: many(["Hikari", "Neon", "Kai", "Vivi", "Ren", "Sora", "Momo"], (i) => (i + 1) * 0.25), formations: [{ at: 0, shape: "pairs", spacing: 1.1 }] },
  kinesphere: { title: "Kinesphere", detail: "Laban's icosahedron: the reach of his body, in space.", example: "gal-apartment", view: "score", dancers: [], kinesphere: true, motion: "smooth" },
  grid: { title: "Coarse grid", detail: "His movement snapped to 90° steps — the notation's view, made visible.", example: "gal-apartment", view: "score", lead: "Robot", dancers: [], gridStep: 90 },
  drawing: { title: "Full drawing", detail: "Every path of the whole phrase at once.", example: "gal-apartment", view: "objects", dancers: [], wholeTrace: true },
} satisfies Record<string, Scene>;

export type SceneId = keyof typeof SCENES;
export const isSceneId = (s: string): s is SceneId => Object.prototype.hasOwnProperty.call(SCENES, s);
