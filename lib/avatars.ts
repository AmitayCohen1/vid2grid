/** Bundled roster; asset sources and licenses are in scripts/setup-assets.mjs.
 *  Portraits are pre-rendered stills of each model (public/avatars, committed)
 *  so the landing page can show the cast without loading any VRM. */
export const DEFAULT_AVATAR_URL = "/models/avatar.vrm";
export const AVATAR_PRESETS: { label: string; url: string; portrait: string }[] = [
  { label: "Hikari", url: DEFAULT_AVATAR_URL, portrait: "/avatars/avatar.png" },
  { label: "Seed-san", url: "/models/seed-san.vrm", portrait: "/avatars/seed-san.png" },
  { label: "Ivy", url: "/models/vroid-a.vrm", portrait: "/avatars/vroid-a.png" },
  { label: "Neon", url: "/models/vroid-b.vrm", portrait: "/avatars/vroid-b.png" },
  { label: "Kuro", url: "/models/vroid-c.vrm", portrait: "/avatars/vroid-c.png" },
];
