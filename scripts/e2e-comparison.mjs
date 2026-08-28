/* End-to-end: focused-Studio Comparison. Requires the dev server on :3000. */
import { chromium } from "playwright";
const URL = "http://localhost:3000/movement-languages/comparison.html";
const die = (m) => { throw new Error(m); };
const browser = await chromium.launch();
let exitCode = 0;
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem("ml_comparison_tour_v1", "1"); } catch { /* private mode */ } });
  await page.goto(URL, { waitUntil: "networkidle" });

  // Three pickers; two checked by default (Laban, Benesh); two panes shown.
  const picks = await page.$$eval(".pick", els => els.map(e => ({ sys: e.dataset.sys, on: e.checked })));
  if (picks.length !== 3) die(`expected 3 pickers, got ${picks.length}`);
  if (picks.filter(p => p.on).length < 2) die("fewer than two notations checked at start");
  const panes0 = await page.$$eval(".pane", els => els.map(e => e.dataset.sys));
  if (panes0.length !== picks.filter(p => p.on).length) die("pane count != checked pickers");

  // Turning a third notation on adds its pane.
  await page.click('.pick[data-sys="ewmn"]');
  if ((await page.$$(".pane")).length !== 3) die("enabling EWMN did not add a third pane");

  // Cannot uncheck below two: uncheck down to two, the last two refuse.
  for (const sys of ["ewmn", "benesh", "laban"]) {
    const box = await page.$(`.pick[data-sys="${sys}"]`);
    if (await box.isChecked()) await box.click().catch(() => {});
  }
  if ((await page.$$eval(".pick", els => els.filter(e => e.checked).length)) < 2) die("picker allowed dropping below two notations");

  if (errs.length) die("console/page errors: " + JSON.stringify(errs));
  console.log("PASS: Comparison shell — picker, min-two, panes track selection");
} catch (e) { console.error("FAIL:", e && e.message ? e.message : e); exitCode = 1; }
finally { await browser.close(); }
process.exit(exitCode);
