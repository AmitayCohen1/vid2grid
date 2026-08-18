/* ------------------------------------------------------------------
   Geometry primitives.

   Body-local space (the dancer's own frame):
     x = dancer's right,  y = up,  z = dancer's forward.
   A limb is a unit direction on the sphere, spelled as
     azimuth   (deg, around y; 0 = forward, 90 = right, 180 = back)
     elevation (deg; 0 = level, +90 = straight up, -90 = straight down)
   ------------------------------------------------------------------ */

export type Vec3 = { x: number; y: number; z: number };
export type AzEl = [az: number, el: number];

export const DEG = Math.PI / 180;

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const mid = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

export function norm(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : { x: 0, y: 1, z: 0 };
}

/** Unit direction from (azimuth, elevation) in degrees. */
export function fromAzEl([az, el]: AzEl): Vec3 {
  const a = az * DEG;
  const e = el * DEG;
  const c = Math.cos(e);
  return { x: Math.sin(a) * c, y: Math.sin(e), z: Math.cos(a) * c };
}

/** (azimuth, elevation) in degrees from a direction. Azimuth normalised to [0, 360). */
export function toAzEl(d: Vec3): AzEl {
  const u = norm(d);
  const az = Math.atan2(u.x, u.z) / DEG;
  const el = Math.asin(Math.max(-1, Math.min(1, u.y))) / DEG;
  return [wrap360(az), el];
}

export const wrap360 = (a: number): number => ((a % 360) + 360) % 360;

/** Signed shortest difference b - a in degrees, in (-180, 180]. */
export const angleDiff = (a: number, b: number): number => ((((b - a) % 360) + 540) % 360) - 180;

export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/** Rotate about the vertical axis by `deg` degrees (positive = towards +x from +z). */
export function rotY(v: Vec3, deg: number): Vec3 {
  const r = deg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/** Express a world-space vector in an orthonormal frame (right, up, forward). */
export function toFrame(v: Vec3, right: Vec3, up: Vec3, fwd: Vec3): Vec3 {
  return { x: dot(v, right), y: dot(v, up), z: dot(v, fwd) };
}
