/* End-to-end: synthetic score JSON → import into vid2grid → save a section →
   danceforms library → choreography build → quarter-beat keys.
   Requires the dev server on http://localhost:3000 and `npx playwright install chromium`. */
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BONE_IDS = ["torso","shoulders","head","ruarm","rfarm","rhand","luarm","lfarm","lhand","rthigh","rshin","rfoot","lthigh","lshin","lfoot"];
const LENS = { torso:.48, shoulders:.36, head:.24, ruarm:.28, rfarm:.26, rhand:.1, luarm:.28, lfarm:.26, lhand:.1, rthigh:.44, rshin:.42, rfoot:.16, lthigh:.44, lshin:.42, lfoot:.16 };

function pose(t, swing) {
  const bones = {};
  for (const id of BONE_IDS) bones[id] = id === "ruarm" || id === "luarm" ? [swing, -20] : [0, id.includes("thigh") || id.includes("shin") ? -85 : 45];
  bones.torso = [0, 86]; bones.head = [0, 76]; bones.shoulders = [90, 0];
  return { t, facing: 0, x: 0, z: 0, hipY: 0.95, bones, conf: 0.9 };
}
function synthScore() {
  const fps = 30, duration = 4, n = fps * duration;
  // Arms swap between +80° and −80° azimuth every 0.5 s → keyframes at 120 bpm.
  const raw = Array.from({ length: n }, (_, i) => pose(i / fps, Math.floor((i / fps) / 0.5) % 2 ? 80 : -80));
  return {
    version: 1,
    source: { name: "synthetic.mp4", duration, fps, width: 640, height: 480 },
    grid: { azStep: 22.5, elStep: 22.5, hysteresis: 0.3, minDwell: 4, facingStep: 45 },
    smooth: { minCutoff: 1.5, beta: 1.0 },
    lift: "anchored",
    body: { lengths: LENS, hipWidth: 0.22, shoulderWidth: 0.36 },
    raw, frames: raw, keyframes: [0],
  };
}

const die = (msg) => { console.error("FAIL:", msg); process.exit(1); };
const dir = mkdtempSync(join(tmpdir(), "v2g-e2e-"));
const scorePath = join(dir, "synthetic.vid2grid.json");
writeFileSync(scorePath, JSON.stringify(synthScore()));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => die("page error: " + e));

// --- vid2grid (/): import the synthetic score, quantize, save a section ---
await page.goto("http://localhost:3000");
// Two file inputs exist on this page (video source + JSON import); only the
// JSON one advertises accept*="json" (Source.tsx's video input is accept="video/*").
await page.setInputFiles('input[accept*="json"]', scorePath);
// SectionPanel.tsx renders this exact string once `score` is derived from the import.
await page.waitForSelector("text=section — quantized", { timeout: 15000 });
await page.fill('input[aria-label="Section name"]', "e2e section");
await page.click("text=save to library");
// SectionPanel's save() sets status to `saved “${name}” — N keys / M beats`
// (curly quotes, not straight ones — matched verbatim from the component source).
await page.waitForSelector("text=saved “e2e section”", { timeout: 5000 });

// --- danceforms studio: same origin ⇒ same IndexedDB, section is already there ---
await page.goto("http://localhost:3000/movement-languages/danceforms.html");
await page.waitForSelector("#libraryList >> text=e2e section", { timeout: 5000 });
// Add the section to the choreography twice (repeats), then build onto the
// selected dancer's key track.
await page.click(".lib-add");
await page.click(".lib-add");
await page.click("#btnChorBuild");
// buildChoreography() -> renderAll() -> save() debounces the localStorage
// write by 250ms; 500ms gives it headroom without polling.
await page.waitForTimeout(500);

const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("danceforms-score-v1")));
const keys = stored.dancers[0].keys;
if (keys.length < 4) die(`expected ≥4 built keys, got ${keys.length}`);
if (!keys.every((k) => Math.round(k.beat * 4) === k.beat * 4)) die("keys not on quarter beats: " + keys.map((k) => k.beat));
const total = await page.textContent("#chorTotal");
if (!/total \d+ beats/.test(total || "")) die("total beats readout missing");

console.log(`PASS: ${keys.length} keys on quarter beats, ${total}`);
await browser.close();
