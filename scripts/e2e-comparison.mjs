/* End-to-end: the Comparison explainer. For each window, asserts the
   window-defining behaviour at the DOM level, complementing the model-level
   acceptance tests in test/notation.test.mjs:
     - the inert panel's content is byte-identical across every variant;
     - the other three panels DO change per variant;
     - the inert badge is on exactly that one panel;
     - Laban keeps a direction/level symbol;
     - every drawn provisional glyph is one registered in the model.
   Also checks the onboarding tour opens and closes.
   Requires the dev server on http://localhost:3000 and chromium installed. */
import { chromium } from "playwright";

const URL = "http://localhost:3000/movement-languages/comparison.html";
const die = (msg) => { throw new Error(msg); };

const WINDOWS = [
  { win: "quality", inert: "ewmn", variants: ["impulse", "impact", "even"] },
  { win: "frame",   inert: "motif", variants: ["standard", "body", "stance"] },
];

const browser = await chromium.launch();
let exitCode = 0;
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  // Skip the auto-tour deterministically.
  await page.addInitScript(() => { try { localStorage.setItem("ml_comparison_tour_v1", "1"); } catch { /* private mode */ } });
  await page.goto(URL, { waitUntil: "networkidle" });

  // Tour opens from the Guide button and closes on Skip.
  await page.click("#guideBtn");
  if (!(await page.$eval("#tour", (el) => el.classList.contains("on")))) die("tour did not open");
  await page.click("#tourSkip");
  if (await page.$eval("#tour", (el) => el.classList.contains("on"))) die("tour did not close");

  const registered = await page.evaluate(() => window.Notation.PROVISIONAL_GLYPHS);
  const content = (sys) => page.$eval(`.pane[data-pane="${sys}"] .content`, (el) => el.innerHTML);

  for (const { win, inert, variants } of WINDOWS) {
    await page.click(`.opt[data-win="${win}"]`);
    const others = ["laban", "benesh", "ewmn", "motif"].filter((s) => s !== inert);
    const snap = {};
    for (const v of variants) {
      await page.click(`.opt[data-variant="${v}"]`);
      snap[v] = {};
      for (const s of ["laban", "benesh", "ewmn", "motif"]) snap[v][s] = await content(s);
      const drawn = await page.$$eval("[data-prov]", (els) => els.map((e) => e.dataset.prov));
      for (const id of drawn) if (!registered.includes(id)) die(`[${win}] unregistered provisional glyph: ${id}`);
    }
    // inert panel identical across all variants
    for (let i = 1; i < variants.length; i++)
      if (snap[variants[i]][inert] !== snap[variants[0]][inert])
        die(`[${win}] inert panel ${inert} changed between variants`);
    // the others differ between the first two variants
    for (const s of others)
      if (snap[variants[0]][s] === snap[variants[1]][s]) die(`[${win}] ${s} did not change between variants`);
    // inert badge on exactly the inert panel
    const inertOn = await page.$$eval("[data-inert]", (els) =>
      els.filter((e) => !e.hidden).map((e) => e.closest(".pane").dataset.pane));
    if (inertOn.length !== 1 || inertOn[0] !== inert) die(`[${win}] inert badge not exclusively on ${inert}: ${JSON.stringify(inertOn)}`);
    // Laban keeps a direction/level symbol
    if (!/path d="M/.test(snap[variants[0]].laban)) die(`[${win}] Laban direction/level symbol missing`);
  }

  if (errs.length) die("console/page errors: " + JSON.stringify(errs));
  console.log("PASS: Comparison — quality (EWMN inert) and reference-frame (Motif inert) windows, tour, provisional glyphs all registered");
} catch (e) {
  console.error("FAIL:", e && e.message ? e.message : e);
  exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
