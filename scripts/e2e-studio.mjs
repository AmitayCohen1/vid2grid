/* End-to-end: DanceForms Studio smoke test. Requires the dev server on :3000.
   This is a CHARACTERIZATION test for the shared-kernel refactor (spec
   2026-09-08): it passes before the refactor and must still pass after. Its
   most valuable assertion is the zero-page-errors one — a missing kernel
   export or a bad script load order shows up there first. */
import { chromium } from "playwright";
const URL = "http://localhost:3000/movement-languages/danceforms.html";
const die = (m) => { throw new Error(m); };
const browser = await chromium.launch();
let exitCode = 0;
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  // Force the built-in demo score: Studio restores an autosaved score if present.
  await page.addInitScript(() => { try { localStorage.removeItem("danceforms-score-v1"); } catch { /* private mode */ } });
  await page.goto(URL, { waitUntil: "networkidle" });

  // 1. The kernel loaded and every symbol resolved.
  if (errs.length) die("page errors on load: " + errs.join(" | "));

  // 2. The demo score rendered into all three notation views.
  for (const id of ["labanView", "beneshView", "ewView"]) {
    const html = await page.$eval("#" + id, (el) => el.innerHTML);
    if (!/^<svg/.test(html)) die(`#${id} did not render an svg`);
  }
  // Laban draws real symbol geometry, not just an empty staff.
  const laban = await page.$eval("#labanView", (el) => el.innerHTML);
  if (!/path d="M/.test(laban)) die("#labanView has no symbol paths");

  // 3. The stage canvas painted something (not a blank canvas).
  const painted = await page.$eval("#stageCanvas", (cv) => {
    const ctx = cv.getContext("2d");
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  });
  if (!painted) die("#stageCanvas is blank");

  // 4. The pose palette built its buttons.
  const poses = await page.$$eval("#palette button[data-preset]", (els) => els.length);
  if (poses < 5) die(`pose palette has only ${poses} entries`);

  // 5. Playback advances the beat readout, then pauses.
  const t0 = await page.$eval("#beatReadout", (el) => el.textContent);
  await page.click("#btnPlay");
  await page.waitForFunction(
    (before) => document.querySelector("#beatReadout").textContent !== before,
    t0, { timeout: 4000 },
  ).catch(() => die("playback did not advance #beatReadout"));
  await page.click("#btnPlay");

  // 6. poseAt interpolates: scrubbing to a non-key beat repaints the stage.
  //    #tlScrub is an SVG <rect>, not a range input — Studio scrubs on
  //    pointerdown (danceforms.html:1857), so click it at a fraction across.
  const shot0 = await page.locator("#stageCanvas").screenshot();
  // #tlScrub sits below the fold in the default viewport; page.mouse.click
  // uses raw viewport coordinates and does not auto-scroll, so the element
  // must be scrolled into view before its boundingBox() is meaningful.
  await page.locator("#tlScrub").scrollIntoViewIfNeeded();
  const box = await page.locator("#tlScrub").boundingBox();
  if (!box) die("#tlScrub not found");
  await page.mouse.click(box.x + box.width * 0.37, box.y + box.height / 2);
  const shot1 = await page.locator("#stageCanvas").screenshot();
  if (Buffer.compare(shot0, shot1) === 0) die("scrubbing the timeline did not repaint the stage");

  // 7. Applying a palette pose rewrites the Laban view (exercises limbVec +
  //    labanQuantAt + labanSymbol end to end).
  const labanBefore = await page.$eval("#labanView", (el) => el.innerHTML);
  await page.click('#palette button[data-preset="3"]');   // "Plié"
  const labanAfter = await page.$eval("#labanView", (el) => el.innerHTML);
  if (labanBefore === labanAfter) die("applying a palette pose did not change #labanView");

  // 8. Still no errors after all that interaction.
  if (errs.length) die("page errors after interaction: " + errs.join(" | "));

  console.log("e2e-studio: OK");
} catch (e) {
  console.error("e2e-studio FAILED:", e.message);
  exitCode = 1;
} finally {
  await browser.close();
  process.exit(exitCode);
}
