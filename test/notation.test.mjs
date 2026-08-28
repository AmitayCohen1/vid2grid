import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const N = createRequire(import.meta.url)("../public/movement-languages/notation.js");

/* A Window-3 fixture: one forearm-lowering gesture, identical geometry, three
   dynamic variants. Only `dynamics` differs between variants; EWMN carries none. */
const window3 = () => ({
  v: 1,
  id: "w3-quality",
  title: "One lowering, three qualities",
  beats: 2,
  segments: ["rfarm"],
  movement: {
    keys: [
      { beat: 0,   bones: { rfarm: [0, 20] } },
      { beat: 1,   bones: { rfarm: [0, -30] } },
      { beat: 1.5, bones: { rfarm: [0, -60] } },
    ],
  },
  readings: {
    laban:  { direction: "forward", level: "low", duration: { start: 0, end: 1.5 }, dynamics: true },
    benesh: { plane: "sagittal", frame: 0, dynamics: true },
    ewmn:   { position: 5, movement: "plane" },              // no dynamics slot (§4.7)
    motif:  { action: "lower", specificity: { state: "unspecified" }, dynamics: true },
  },
  variants: [
    { id: "impulse", label: "Impulse", dynamics: "impulse" },
    { id: "impact",  label: "Impact",  dynamics: "impact" },
    { id: "even",    label: "Even",    dynamics: "even" },
  ],
  inertPanel: "ewmn",
});

test("validateFixture accepts the Window-3 fixture", () => {
  assert.doesNotThrow(() => N.validateFixture(window3()));
});

test("validateFixture rejects EWMN carrying dynamics (§4.7 / invariant 8)", () => {
  const fx = window3();
  fx.readings.ewmn.dynamics = true;
  assert.throws(() => N.validateFixture(fx), /EWMN carries no dynamics/);
});

test("validateFixture enforces version, beats range, and a key at beat 0", () => {
  assert.throws(() => N.validateFixture({ ...window3(), v: 2 }), /version/);
  assert.throws(() => N.validateFixture({ ...window3(), beats: 9 }), /beats/);
  const noZero = window3();
  noZero.movement.keys = noZero.movement.keys.slice(1);
  assert.throws(() => N.validateFixture(noZero), /beat 0/);
});

test("validateFixture rejects a movement segment not declared in segments", () => {
  const fx = window3();
  fx.movement.keys[0].bones = { luarm: [0, 0] }; // rfarm missing
  assert.throws(() => N.validateFixture(fx), /segment rfarm/);
});

/* --- Invariant 4: one beat, four axis transforms ------------------------- */
test("advancing the shared beat moves every panel's playhead by the same fraction", () => {
  const beats = 2;
  for (const beat of [0, 0.5, 1, 1.5]) {
    const fracs = N.SYSTEMS.map((s) => N.beatToAxis(beat, beats, s).along);
    assert.ok(fracs.every((f) => f === fracs[0]), "along fraction identical across panels at beat " + beat);
    assert.equal(fracs[0], beat / beats);
  }
});

test("vertical panels flow up, horizontal panels flow right", () => {
  assert.deepEqual(N.axisVector("laban"), { x: 0, y: -1 });
  assert.deepEqual(N.axisVector("motif"), { x: 0, y: -1 });
  assert.deepEqual(N.axisVector("benesh"), { x: 1, y: 0 });
  assert.deepEqual(N.axisVector("ewmn"), { x: 1, y: 0 });
  // Same beat, rotated layout: a vertical panel places it up from the bottom,
  // a horizontal one places it right from the left.
  const box = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(N.beatToAxis(1, 2, "laban", box).y, 50);  // halfway up (top = y 0)
  assert.equal(N.beatToAxis(1, 2, "benesh", box).x, 50); // halfway right
});

/* --- Invariant 2: tri-state data, four ink states ------------------------ */
test("four ink states map as the spec fixes them (§5.3)", () => {
  assert.deepEqual(N.inkFor("value"), { drawn: true, fill: true, stroke: true, dash: false });
  assert.deepEqual(N.inkFor("unspecified"), { drawn: true, fill: false, stroke: true, dash: false });
  assert.deepEqual(N.inkFor("not_applicable"), { drawn: false, fill: false, stroke: false, dash: false });
  assert.deepEqual(N.inkFor("unknown"), { drawn: true, fill: false, stroke: true, dash: true });
});

test("resolveField normalises bare and tagged fields, and rejects `unknown` as data", () => {
  assert.deepEqual(N.resolveField("low"), { state: "value", value: "low" });
  assert.deepEqual(N.resolveField({ state: "unspecified" }), { state: "unspecified" });
  assert.deepEqual(N.resolveField({ state: "not_applicable" }), { state: "not_applicable" });
  assert.throws(() => N.resolveField({ state: "unknown" }), /render state/);
});

/* --- Dynamics envelope --------------------------------------------------- */
test("envelopes front-load impulse, back-load impact, hold even", () => {
  assert.ok(N.envelope("impulse", 0) > N.envelope("impulse", 1)); // decays
  assert.ok(N.envelope("impact", 1) > N.envelope("impact", 0));   // builds
  assert.equal(N.envelope("even", 0), N.envelope("even", 1));     // flat
  for (const k of ["impulse", "impact", "even"]) for (const t of [0, 0.5, 1]) {
    const v = N.envelope(k, t);
    assert.ok(v >= 0 && v <= 1, k + "@" + t + " in range");
  }
  assert.equal(N.accentAt("impulse"), "start");
  assert.equal(N.accentAt("impact"), "end");
  assert.equal(N.accentAt("even"), "none");
});

/* --- Acceptance: Window 3 EWMN is inert across variants ------------------- */
test("EWMN reading is byte-identical across all three dynamic variants", () => {
  const fx = window3();
  const s = fx.variants.map((v) => N.serializeReading(fx, "ewmn", v.id));
  assert.equal(s[0], s[1]);
  assert.equal(s[1], s[2]);
});

/* --- Acceptance: Window 3 Laban keeps space, changes only quality -------- */
test("Laban direction and level are identical across variants while the overlay differs", () => {
  const fx = window3();
  for (const v of fx.variants) {
    assert.deepEqual(N.readingField(fx, "laban", "direction"), { state: "value", value: "forward" });
    assert.deepEqual(N.readingField(fx, "laban", "level"), { state: "value", value: "low" });
  }
  const ser = fx.variants.map((v) => N.serializeReading(fx, "laban", v.id));
  assert.notEqual(ser[0], ser[1]); // impulse vs impact: dynamics folded in
  assert.notEqual(ser[1], ser[2]);
  // ...but each carries the same spatial content.
  for (const s of ser) assert.match(s, /"direction":\{"state":"value","value":"forward"\}/);
});

test("Motif and Benesh carry dynamics; EWMN does not", () => {
  assert.equal(N.systemCarriesDynamics("motif"), true);
  assert.equal(N.systemCarriesDynamics("benesh"), true);
  assert.equal(N.systemCarriesDynamics("laban"), true);
  assert.equal(N.systemCarriesDynamics("ewmn"), false);
});

/* ======================= Window 1 — reference frame ======================= */
/* Same held geometry (a tilted torso + a "forward" gesture), three frame
   variants. Motif's frame is UNSPECIFIED, so it is the inert panel. */
const window1 = () => ({
  v: 1, axis: "frame",
  id: "w1-frame", title: "One direction, three frames",
  beats: 2, segments: ["ruarm"],
  movement: {
    keys: [
      { beat: 0, bones: { ruarm: [0, 0] } },
      { beat: 1, bones: { ruarm: [0, 0] } },
    ],
  },
  readings: {
    laban:  { direction: "forward", level: "middle", frame: true },
    benesh: { plane: "sagittal", frame: true },
    ewmn:   { position: 3, frame: true },
    motif:  { action: "gesture", referenceFrame: { state: "unspecified" } },
  },
  variants: [
    { id: "standard", label: "Standard", frame: "standard" },
    { id: "body",     label: "Body",     frame: "body" },
    { id: "stance",   label: "Stance",   frame: "stance" },
  ],
  inertPanel: "motif",
});

test("validateFixture accepts a frame-axis fixture and rejects a bad frame", () => {
  assert.doesNotThrow(() => N.validateFixture(window1()));
  const bad = window1(); bad.variants[0].frame = "sideways";
  assert.throws(() => N.validateFixture(bad), /unknown frame/);
  const badAxis = window1(); badAxis.axis = "colour";
  assert.throws(() => N.validateFixture(badAxis), /unknown axis/);
});

test("resolveDirection: standard is identity, body/stance rotate by the tilt", () => {
  const body = { torsoTilt: 40, stanceTilt: 15 };
  assert.deepEqual(N.resolveDirection([0, 0], "standard", body), [0, 0]);
  assert.deepEqual(N.resolveDirection([0, 0], "body", body), [0, -40]);
  assert.deepEqual(N.resolveDirection([0, 0], "stance", body), [0, -15]);
  // Upright body: all three frames coincide.
  const up = { torsoTilt: 0, stanceTilt: 0 };
  const r = ["standard", "body", "stance"].map((f) => N.resolveDirection([0, 20], f, up));
  assert.deepEqual(r[0], r[1]); assert.deepEqual(r[1], r[2]);
});

test("frame hues are declared and distinct (invariant 6: hue = frame)", () => {
  const hues = N.FRAMES.map((f) => N.frameHue(f));
  assert.equal(new Set(hues).size, N.FRAMES.length);
});

/* --- Acceptance: Window 1 Motif is inert across the three frames ---------- */
test("Motif reading is byte-identical across all three frames; the others differ", () => {
  const fx = window1();
  const motif = fx.variants.map((v) => N.serializeReading(fx, "motif", v.id));
  assert.equal(motif[0], motif[1]); assert.equal(motif[1], motif[2]);
  for (const sys of ["laban", "benesh", "ewmn"]) {
    const s = fx.variants.map((v) => N.serializeReading(fx, sys, v.id));
    assert.notEqual(s[0], s[1]); assert.notEqual(s[1], s[2]);
  }
  // Motif's frame is drawn as UNSPECIFIED, not absent (§5.3).
  assert.deepEqual(N.readingField(fx, "motif", "referenceFrame"), { state: "unspecified" });
});

/* --- Provisional glyphs are declared, not silently trusted ---------------- */
test("dynamics wedges and Motif strokes are registered as provisional", () => {
  assert.ok(N.isProvisional("laban.dynamics.impulse-wedge"));
  assert.ok(N.isProvisional("motif.action-stroke"));
  assert.ok(!N.isProvisional("laban.direction.forward"));
});

/* ======================= notation-render.js: pose model ======================= */
const R = createRequire(import.meta.url)("../public/movement-languages/notation-render.js");

test("standPose fills all ten bones as [az,el] pairs", () => {
  const p = R.standPose();
  for (const b of R.BONES) assert.ok(Array.isArray(p.bones[b.id]) && p.bones[b.id].length === 2, b.id);
});

test("skeleton of the upright pose puts the chest above the root and returns 11 segments", () => {
  const sk = R.skeleton(R.standPose());
  assert.equal(sk.seg.length, 11);                 // torso, clav, pelvis, + 8 limb bones
  const torso = sk.seg.find(s => s[0] === "torso");
  assert.ok(torso[2].y > torso[1].y, "chest is above the root");
});

test("limbVec returns a unit vector for the right arm", () => {
  const v = R.limbVec(R.standPose(), "rarm");
  assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-9);
});

/* ======================= notation-render.js: Laban renderer ======================= */
const w3dancer = () => ({
  beats: 2,
  keys: [
    { beat: 0,   pose: R.merge(R.standPose(), { rfarm: [0, 20] }) },
    { beat: 1,   pose: R.merge(R.standPose(), { rfarm: [0, -30] }) },
    { beat: 1.5, pose: R.merge(R.standPose(), { rfarm: [0, -60] }) },
  ],
});

test("renderLaban returns an SVG staff with at least one direction/level symbol", () => {
  const svg = R.renderLaban(w3dancer(), {});
  assert.match(svg, /^<svg/);
  assert.match(svg, /path d="M/);              // a Laban symbol path (invariant: shape = direction)
  assert.match(svg, /R ARM/);                  // a column label
});

test("renderLaban focus emphasizes the focused column and dims the rest", () => {
  const svg = R.renderLaban(w3dancer(), { focusSegment: "rfarm" });
  assert.match(svg, /class="[^"]*focus[^"]*" data-col="rarm"/);
  assert.match(svg, /class="[^"]*dim[^"]*" data-col="larm"/);
});
