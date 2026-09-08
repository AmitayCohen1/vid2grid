/** Bundled roster; asset sources and licenses are in scripts/setup-assets.mjs.
 *  Portraits are pre-rendered stills of each model (public/avatars, committed)
 *  so the landing page can show the cast without loading any VRM.
 *
 *  A preset's `url` is its identity everywhere (picker, cast thumbnails,
 *  saved members). Several presets may share one VRM file and differ only
 *  by `tint`: material-name substring → colour multiplied into that
 *  material's lit and shade colours when the rig loads (see Avatar.tsx).
 *  Such presets get a distinct `url` by fragment; `avatarFile` strips it. */
export const DEFAULT_AVATAR_URL = "/models/avatar.vrm";
export interface AvatarPreset { label: string; url: string; portrait: string; tint?: Record<string, string> }
export const AVATAR_PRESETS: AvatarPreset[] = [
  { label: "Hikari", url: DEFAULT_AVATAR_URL, portrait: "/avatars/avatar.png" },
  { label: "Seed-san", url: "/models/seed-san.vrm", portrait: "/avatars/seed-san.png" },
  { label: "Ivy", url: "/models/vroid-a.vrm", portrait: "/avatars/vroid-a.png" },
  { label: "Neon", url: "/models/vroid-b.vrm", portrait: "/avatars/vroid-b.png" },
  { label: "Kuro", url: "/models/vroid-c.vrm", portrait: "/avatars/vroid-c.png" },
  { label: "Vita", url: "/models/vita.vrm", portrait: "/avatars/vita.png" },
  { label: "Vivi", url: "/models/vivi.vrm", portrait: "/avatars/vivi.png" },
  { label: "Victoria", url: "/models/victoria.vrm", portrait: "/avatars/victoria.png" },
  { label: "Shibu", url: "/models/shibu.vrm", portrait: "/avatars/shibu.png" },
  { label: "Fumiriya", url: "/models/fumiriya.vrm", portrait: "/avatars/fumiriya.png" },
  { label: "Sora", url: "/models/hair-male.vrm", portrait: "/avatars/sora.png" },
  { label: "Kai", url: "/models/hair-male.vrm#kai", portrait: "/avatars/kai.png", tint: { Tops: "#4f7f5e", Hair: "#a0a0a8" } },
  { label: "Ren", url: "/models/hair-male.vrm#ren", portrait: "/avatars/ren.png", tint: { Tops: "#883a3a", Hair: "#e0b878" } },
];

/** The file behind a preset url (the fragment only tells presets apart). */
export const avatarFile = (url: string) => url.replace(/#.*$/, "");
export const avatarTint = (url: string) => AVATAR_PRESETS.find((a) => a.url === url)?.tint;

/** Frames in each character's turnaround sheet (`<portrait>-turn.png`,
 *  laid out left to right: one full turn, 120×160 per frame). */
export const TURN_FRAMES = 24;
export const turnSheet = (portrait: string) => portrait.replace(/\.png$/, "-turn.png");
