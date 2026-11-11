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
