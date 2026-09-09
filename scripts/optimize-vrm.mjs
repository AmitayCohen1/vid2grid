// Shrinks a VRM (a GLB) for the web: textures are the bulk of a VRoid model
// (10–16 MB of 2048² PNGs in a 20 MB file), and on a stage figure a few
// hundred pixels tall none of that resolution is visible. Every texture is
// resized to at most MAX_SIDE and re-encoded — JPEG when it has no
// transparency, palette PNG when it does — and the preview thumbnail is
// reduced to a stamp. Geometry, materials and the rig are untouched.
//
// Usage: node scripts/optimize-vrm.mjs <in.vrm> [out.vrm]   (in place when out is omitted)
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import sharp from "sharp";

export const OPTIMIZED = 2; // bump to re-optimise files done with an older recipe
const MAX_SIDE = 1024;
const THUMB_SIDE = 64;
const JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString("utf8"));
    else if (type === BIN_CHUNK) bin = data;
    off += 8 + len;
  }
  if (!json || !bin) throw new Error("GLB without JSON and BIN chunks");
  return { json, bin };
}

function writeGlb(json, bin) {
  const pad4 = (n) => (n + 3) & ~3;
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)]);
  const binBuf = Buffer.concat([bin, Buffer.alloc(pad4(bin.length) - bin.length, 0)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const chunk = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([header, chunk(jsonBuf.length, JSON_CHUNK), jsonBuf, chunk(binBuf.length, BIN_CHUNK), binBuf]);
}

/** Is this file already done with the current recipe? */
export function isOptimized(buf) {
  try { return readGlb(buf).json.asset?.extras?.vid2gridOptimized >= OPTIMIZED; } catch { return false; }
}

/** The image that is only the model's preview picture (VRM 0.x and 1.0 name it differently). */
function thumbnailImage(json) {
  const v1 = json.extensions?.VRMC_vrm?.meta?.thumbnailImage;
  if (typeof v1 === "number") return v1;
  const tex = json.extensions?.VRM?.meta?.texture;
  if (typeof tex === "number" && tex >= 0) return json.textures?.[tex]?.source ?? -1;
  return -1;
}

async function encode(bytes, { maxSide, forceAlphaPng = false }) {
  const img = sharp(bytes);
  const meta = await img.metadata();
  let alpha = false;
  if (meta.hasAlpha) {
    const stats = await img.stats();
    const a = stats.channels[stats.channels.length - 1];
    alpha = a.min < 250; // an all-opaque alpha channel carries nothing
  }
  const side = Math.max(meta.width ?? 0, meta.height ?? 0);
  let out = sharp(bytes);
  if (side > maxSide) out = out.resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
  if (alpha || forceAlphaPng) return { data: await out.png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer(), mime: "image/png" };
  return { data: await out.jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer(), mime: "image/jpeg" };
}

export async function optimizeVrm(buf) {
  const { json, bin } = readGlb(buf);
  const thumb = thumbnailImage(json);
  // Images referenced by materials must keep their fidelity; a thumbnail that is only a thumbnail can be a stamp.
  const usedByMaterial = new Set();
  for (const m of json.materials ?? []) {
    const walk = (o) => { if (!o || typeof o !== "object") return; if (typeof o.index === "number" && "index" in o && !("bufferView" in o)) usedByMaterial.add(json.textures?.[o.index]?.source); for (const v of Object.values(o)) walk(v); };
    walk(m);
  }
  const replaced = new Map(); // bufferView index → { data, mime }
  for (let i = 0; i < (json.images ?? []).length; i++) {
    const im = json.images[i];
    if (typeof im.bufferView !== "number") continue;
    const bv = json.bufferViews[im.bufferView];
    const bytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const isThumb = i === thumb && !usedByMaterial.has(i);
    const enc = await encode(bytes, { maxSide: isThumb ? THUMB_SIDE : MAX_SIDE });
    if (enc.data.length < bytes.length) { replaced.set(im.bufferView, enc); im.mimeType = enc.mime; }
  }
  // Rebuild the binary chunk with the new image bytes, keeping every view 4-aligned.
  const parts = []; let offset = 0;
  for (let i = 0; i < json.bufferViews.length; i++) {
    const bv = json.bufferViews[i];
    const data = replaced.get(i)?.data ?? bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    bv.byteOffset = offset; bv.byteLength = data.length;
    const padded = (data.length + 3) & ~3;
    parts.push(data); if (padded > data.length) parts.push(Buffer.alloc(padded - data.length));
    offset += padded;
  }
  json.buffers[0].byteLength = offset;
  json.asset = { ...(json.asset ?? {}), extras: { ...(json.asset?.extras ?? {}), vid2gridOptimized: OPTIMIZED } };
  return writeGlb(json, Buffer.concat(parts));
}

/** Optimise a file in place (atomically) unless it is already done. Returns [before, after] bytes. */
export async function optimizeFile(path) {
  const before = readFileSync(path);
  if (isOptimized(before)) return [before.length, before.length];
  const after = await optimizeVrm(before);
  writeFileSync(path + ".tmp", after);
  renameSync(path + ".tmp", path);
  return [before.length, after.length];
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [input, output] = process.argv.slice(2);
  if (!input) { console.error("usage: optimize-vrm.mjs <in.vrm> [out.vrm]"); process.exit(1); }
  const before = readFileSync(input);
  const after = await optimizeVrm(before);
  writeFileSync(output ?? input, after);
  console.log(`${input}: ${(before.length / 1e6).toFixed(1)} MB → ${(after.length / 1e6).toFixed(1)} MB`);
}
