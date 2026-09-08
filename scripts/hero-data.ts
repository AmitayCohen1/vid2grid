/* ------------------------------------------------------------------
   Regenerate the landing hero's data: public/demo/alice.json for
   public/demo/alice.mp4 (or any other clip), through the app's own
   pipeline — the same tracker, lifting, smoothing and picture anchors
   the studio uses. It runs in a browser, on the dev server's origin, so
   /mediapipe and /models resolve:

     npx esbuild scripts/hero-data.ts --bundle --format=iife --outfile=/tmp/hero-data.js
     # then, with `next dev` running on :3000, in Playwright (or DevTools):
     #   page.goto("http://localhost:3000/"); page.addScriptTag({ path: "/tmp/hero-data.js" });
     #   json = await page.evaluate(() => window.__heroData("/demo/alice.mp4", 30));
     #   fs.writeFileSync("public/demo/alice.json", json);

   Cut the clip first (ffmpeg -ss … -t … -an -c:v libx264 -crf 25); keep
   it short, the JSON is ~25 KB per second at 30 fps.
   ------------------------------------------------------------------ */
import { trackVideo, fillGaps } from "../lib/tracker";
import { buildScore, serializeScore } from "../lib/score";
import { videoAnchors } from "../lib/invideo";

declare global {
  interface Window { __heroData: (url: string, fps: number) => Promise<string>; __heroProgress: number }
}

window.__heroProgress = 0;
window.__heroData = async (url, fps) => {
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.preload = "auto";
  video.src = url;
  document.body.appendChild(video);
  await new Promise<void>((res, rej) => { video.onloadeddata = () => res(); video.onerror = () => rej(new Error(`could not load ${url}`)); });
  const tracked = await trackVideo(video, { fps, onProgress: (done, total) => { window.__heroProgress = done / total; } });
  const ex = fillGaps(tracked, fps);
  const source = { name: url.replace(/^.*\//, "").replace(/\.[^.]+$/, ""), duration: video.duration, fps, width: video.videoWidth, height: video.videoHeight };
  const score = buildScore(ex, source);
  const anchors = videoAnchors(tracked.map((f) => f.image), ex.map((e) => e.metresPerUnit), score.raw.map((p) => p.hipY), video.videoWidth / video.videoHeight);
  const r = (n: number) => Math.round(n * 10000) / 10000;
  // Only what the hero reads (components/HeroDuet.tsx): the smooth track, the body, the picture
  // anchors, and the tracker's 2D landmarks (x, y, visibility per landmark) to draw over the picture.
  const { raw, body } = JSON.parse(serializeScore(score));
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const image = tracked.map((f) => (f.image ? Array.from(f.image, r3) : null));
  return JSON.stringify({ source, body, raw, anchors: anchors.map((a) => [r(a.u), r(a.floorV), r(a.mpu)]), image });
};
