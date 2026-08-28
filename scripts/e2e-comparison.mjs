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

  // Disagreement strip on default picks (Laban + Benesh, both dynamics-carriers):
  // no structural gap, so the strip stays visible with a plain "no gap" line
  // rather than vanishing (spec: "says so plainly rather than vanishing").
  const disagreeDefault = await page.$eval("#disagree", el => ({ hidden: el.hidden, txt: el.textContent }));
  if (disagreeDefault.hidden) die("disagreement strip is hidden on default load (should show the no-gap line)");
  if (/inert-dot|eshkol|ewmn/i.test(disagreeDefault.txt)) die("default-load disagreement strip names a system as inert");

  // Turning a third notation on adds its pane.
  await page.click('.pick[data-sys="ewmn"]');
  if ((await page.$$(".pane")).length !== 3) die("enabling EWMN did not add a third pane");

  // Cannot uncheck below two: uncheck down to two, the last two refuse.
  for (const sys of ["ewmn", "benesh", "laban"]) {
    const box = await page.$(`.pick[data-sys="${sys}"]`);
    if (await box.isChecked()) await box.click().catch(() => {});
  }
  if ((await page.$$eval(".pick", els => els.filter(e => e.checked).length)) < 2) die("picker allowed dropping below two notations");

  // Laban pane draws a real staff.
  await page.reload({ waitUntil: "networkidle" });
  const labanBody = await page.$eval('.pane[data-sys="laban"] .pane-body', el => el.innerHTML);
  if (!/^<svg/.test(labanBody) || !/path d="M/.test(labanBody)) die("Laban pane has no staff");
  // Focus a segment: its column emphasized, another dimmed.
  await page.selectOption("#focusSel", "rfarm");
  const focused = await page.$eval('.pane[data-sys="laban"] .pane-body', el => el.innerHTML);
  if (!/class="[^"]*focus[^"]*" data-col="rarm"/.test(focused)) die("focus did not emphasize the R arm column");
  if (!/class="[^"]*dim[^"]*" data-col="larm"/.test(focused)) die("focus did not dim the other columns");

  // Benesh pane draws a real stave.
  const beneshBody = await page.$eval('.pane[data-sys="benesh"] .pane-body', el => el.innerHTML);
  if (!/^<svg/.test(beneshBody) || !/class="stave"/.test(beneshBody)) die("Benesh pane has no stave");

  // EWMN pane draws a real manuscript grid.
  await page.click('.pick[data-sys="ewmn"]');
  const ewBody = await page.$eval('.pane[data-sys="ewmn"] .pane-body', el => el.innerHTML);
  if (!/^<svg/.test(ewBody)) die("EWMN pane has no grid");

  // Disagreement strip: with all three notations picked, EWMN's missing
  // dynamics (§4.7) is surfaced below the panels.
  const ewmnBox = await page.$('.pick[data-sys="ewmn"]');
  if (!(await ewmnBox.isChecked())) await ewmnBox.click(); // ensure on
  const disagree = await page.$eval("#disagree", el => ({ hidden: el.hidden, txt: el.textContent }));
  if (disagree.hidden || !/eshkol|ewmn|dynamics/i.test(disagree.txt)) die("disagreement strip missing EWMN dynamics note");

  // Presets load and change the score.
  const before = await page.$eval('.pane[data-sys="laban"] .pane-body', el => el.innerHTML);
  await page.selectOption("#presetSel", await page.$eval("#presetSel option:nth-child(2)", o => o.value));
  const after = await page.$eval('.pane[data-sys="laban"] .pane-body', el => el.innerHTML);
  if (before === after) die("selecting a preset did not change the Laban panel");
  // Light editor nudges a joint and redraws.
  await page.selectOption("#focusSel", "rfarm");
  const pre = await page.$eval('.pane[data-sys="ewmn"] .pane-body', el => el.innerHTML);
  await page.click('#nudgeElUp');
  const post = await page.$eval('.pane[data-sys="ewmn"] .pane-body', el => el.innerHTML);
  if (pre === post) die("nudging elevation did not change the EWMN panel");

  // Guided tour: opens on Guide, closes on Skip, steps target live elements.
  await page.click("#guideBtn");
  if (!(await page.$eval("#tour", el => el.classList.contains("on")))) die("tour did not open");
  await page.click("#tourSkip");
  if (await page.$eval("#tour", el => el.classList.contains("on"))) die("tour did not close");

  // Provisional-glyph guard: every drawn [data-prov] id must be registered.
  // The live ported renderers reuse Studio's faithful glyphs and carry no
  // data-prov markers, so this is expected to find zero drawn ids today —
  // it is a safety net against a future unregistered provisional glyph.
  const registered = await page.evaluate(() => window.Notation.PROVISIONAL_GLYPHS);
  const drawn = await page.$$eval("[data-prov]", els => els.map(e => e.dataset.prov));
  for (const id of drawn) if (!registered.includes(id)) die("unregistered provisional glyph: " + id);

  if (errs.length) die("console/page errors: " + JSON.stringify(errs));
  console.log("PASS: Comparison shell — picker, min-two, panes track selection, tour, provisional-glyph guard");
} catch (e) { console.error("FAIL:", e && e.message ? e.message : e); exitCode = 1; }
finally { await browser.close(); }
process.exit(exitCode);
