/* ------------------------------------------------------------------
   Backdrops for the 3D stage: what is drawn behind the figure.

   Two kinds. *Places* are 360° photographs (Poly Haven, CC0, the set
   drei ships as presets) copied to public/backdrops so nothing is
   fetched from elsewhere; the stage shows them as the background only,
   the lighting stays the same. *Made* backdrops are drawn in code:
   a flat colour, a vertical gradient (top → bottom of the view), or a
   pool of light on a dark floor, or a *floor*: a picture laid on the
   ground at real size (metres) under walls of a gradient. `fog` fades the floor grid into the
   backdrop so the horizon doesn't cut across it.
   ------------------------------------------------------------------ */

export type Backdrop =
  | { id: string; label: string; kind: "colour"; colour: string }
  | { id: string; label: string; kind: "gradient"; top: string; bottom: string }
  | { id: string; label: string; kind: "spotlight"; colour: string; light: string }
  | { id: string; label: string; kind: "place"; file: string; thumb: string }
  | { id: string; label: string; kind: "floor"; top: string; bottom: string; floor: { src: string; thumb: string; w: number; d: number; x: number; z: number } };

const place = (id: string, label: string): Backdrop => ({ id, label, kind: "place", file: `/backdrops/${id}.hdr`, thumb: `/backdrops/${id}.jpg` });

export const BACKDROPS: Backdrop[] = [
  { id: "black", label: "Black", kind: "colour", colour: "#0b0c0f" },
  { id: "spotlight", label: "Spotlight", kind: "spotlight", colour: "#030304", light: "#fff4e0" },
  // Gal's bed, as the hero clip films it from above, with him taken out (the median of every second of
  // "Bed 1.0"), laid at the size the tracker measured (1.93 m across the picture) and centred on where he lies.
  { id: "bed", label: "Gal's bed", kind: "floor", top: "#efe6d4", bottom: "#cdb190", floor: { src: "/backdrops/gal-floor.jpg", thumb: "/backdrops/gal-floor-thumb.jpg", w: 1.93, d: 2.4, x: 0.2, z: 0.1 } },
  { id: "gal", label: "Gal's room", kind: "gradient", top: "#cdb190", bottom: "#6d3128" },
  { id: "paper", label: "Paper", kind: "colour", colour: "#f4f2ec" },
  { id: "white", label: "White studio", kind: "gradient", top: "#ffffff", bottom: "#dedcd6" },
  { id: "grey", label: "Grey", kind: "colour", colour: "#2a2d33" },
  { id: "navy", label: "Navy", kind: "colour", colour: "#0f1a2e" },
  { id: "dusk", label: "Dusk", kind: "gradient", top: "#1b1430", bottom: "#e07a5f" },
  { id: "fog", label: "Fog", kind: "gradient", top: "#e3e6ea", bottom: "#8f98a3" },
  { id: "rose", label: "Rose", kind: "gradient", top: "#f6d5d0", bottom: "#b4566b" },
  place("warehouse", "Warehouse"),
  place("apartment", "Apartment"),
  place("lobby", "Lobby"),
  place("city", "City"),
  place("park", "Park"),
  place("forest", "Forest"),
  place("dawn", "Dawn"),
  place("sunset", "Sunset"),
  place("night", "Night"),
];

export const DEFAULT_BACKDROP = BACKDROPS[0] as Extract<Backdrop, { kind: "colour" }>;

export const backdropById = (id: string | undefined): Backdrop => BACKDROPS.find((b) => b.id === id) ?? DEFAULT_BACKDROP;

/** A CSS background for the backdrop's button. */
export function swatch(b: Backdrop): string {
  switch (b.kind) {
    case "colour": return b.colour;
    case "gradient": return `linear-gradient(${b.top}, ${b.bottom})`;
    case "spotlight": return `radial-gradient(circle at 50% 70%, ${b.light} 0 18%, ${b.colour} 55%)`;
    case "place": return `center / cover url(${b.thumb})`;
    case "floor": return `center / cover url(${b.floor.thumb})`;
  }
}
