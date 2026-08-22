/* End-to-end: synthetic score JSON → import into vid2grid → save a section →
   danceforms library → choreography build → quarter-beat keys.
   Requires the dev server on http://localhost:3000 and `npx playwright install chromium`. */
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BONE_IDS = ["torso","shoulders","head","ruarm","rfarm","rhand","luarm","lfarm","lhand","rthigh","rshin","rfoot","lthigh","lshin","lfoot"];
const LENS = { torso:.48, shoulders:.36, head:.24, ruarm:.28, rfarm:.26, rhand:.1, luarm:.28, lfarm:.26, lhand:.1, rthigh:.44, rshin:.42, rfoot:.16, lthigh:.44, lshin:.42, lfoot:.16 };

function pose(t, swing) {
  const bones = {};
  // Both ruarm AND luarm take the same `swing` azimuth — the section's fingerprint:
  // demo presets are all mirror-symmetric (ruarm az > 0, luarm az < 0), never this.
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

const die = (msg) => { throw new Error(msg); };
const dir = mkdtempSync(join(tmpdir(), "v2g-e2e-"));
const scorePath = join(dir, "synthetic.vid2grid.json");
writeFileSync(scorePath, JSON.stringify(synthScore()));

const browser = await chromium.launch();
let exitCode = 0;
try {
  const page = await browser.newPage();
  // Any uncaught page-side error is a failure; record it and gate on it at the
  // natural checkpoints (throwing from an async event handler wouldn't reach
  // this try/catch, so we sample the flag instead).
  let pageError = null;
  page.on("pageerror", (e) => { pageError = e; });
  const checkPage = () => { if (pageError) die("page error: " + pageError); };

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
  checkPage();

  // --- danceforms studio: same origin ⇒ same IndexedDB, section is already there ---
  await page.goto("http://localhost:3000/movement-languages/danceforms.html");
  await page.waitForSelector("#libraryList >> text=e2e section", { timeout: 5000 });

  // The page's init runs renderAll()→save(), so the DEMO score (dancers[0]
  // "Dancer 1" = 5 mirror-symmetric keys at integer beats 0/6/12/20/28) gets
  // persisted before we act — but save() debounces the write by 250ms, so wait
  // for it to flush. Capturing it proves the demo default really is what sits in
  // localStorage pre-build, i.e. exactly what a no-op build would leave behind.
  await page.waitForFunction(() => {
    const s = localStorage.getItem("danceforms-score-v1");
    return !!(s && JSON.parse(s).dancers);
  }, { timeout: 5000 });
  const beforeKeys = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("danceforms-score-v1")).dancers[0].keys.length);

  // Add the section to the choreography twice (repeats), then build onto the
  // selected dancer's key track.
  await page.click(".lib-add");
  await page.click(".lib-add");
  await page.click("#btnChorBuild");
  // buildChoreography() -> renderAll() -> save() debounces the localStorage
  // write by 250ms; 500ms gives it headroom without polling.
  await page.waitForTimeout(500);
  checkPage();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("danceforms-score-v1")));
  const keys = stored.dancers[0].keys;
  if (keys.length < 4) die(`expected ≥4 built keys, got ${keys.length}`);
  if (!keys.every((k) => Math.round(k.beat * 4) === k.beat * 4)) die("keys not on quarter beats: " + keys.map((k) => k.beat));

  // Crux: prove the build carried the SYNTHETIC section's pose and didn't
  // silently no-op back to the demo default. #chorTotal's text and the
  // ≥4/quarter-beat checks above are all satisfiable by the demo's own 5 keys
  // (integer beats are quarter-multiples too), so they can't detect a no-op.
  // The synthetic section swings BOTH arms to the same ±80° azimuth
  // (ruarm[0] === luarm[0], |az| = 80). Every demo Dancer-1 preset is
  // mirror-symmetric — ruarm az > 0, luarm az < 0, opposite signs — so
  // "both arms the same side AND both |az| > 40" is impossible for the demo
  // and unique to the built section. (Note: a bare |ruarm| > 40 would NOT
  // discriminate — demo PRESETS[9] "Tilt" has ruarm az 100.)
  const swung = keys.some((k) => {
    const b = k.pose && k.pose.bones;
    return b && Math.abs(b.ruarm[0]) > 40 && Math.abs(b.luarm[0]) > 40 &&
      Math.sign(b.ruarm[0]) === Math.sign(b.luarm[0]);
  });
  if (!swung) die("built keys don't carry the synthetic section's both-arms-same-side ±80° swing — build may have no-op'd to the demo mirror-symmetric pose");

  const total = await page.textContent("#chorTotal");
  const m = (total || "").match(/total (\d+) beats/);
  if (!m || +m[1] < 1) die("total beats readout missing or zero: " + JSON.stringify(total));

  console.log(`PASS: ${keys.length} keys on quarter beats (demo pre-build had ${beforeKeys}), synthetic-section swing verified, ${total}`);
} catch (e) {
  console.error("FAIL:", e && e.message ? e.message : e);
  exitCode = 1;
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(exitCode);
