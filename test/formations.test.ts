import { test } from "node:test";
import assert from "node:assert/strict";
import { type Cue, SHAPES, facingRot, formationPlacements, placementsAt, sanitizeCues, shapeSlots } from "../lib/formations";

test("every shape gives n distinct, centred slots with the lead first", () => {
  for (const { id } of SHAPES) {
    for (const n of [1, 2, 3, 5, 8]) {
      const slots = shapeSlots(id, n, 1.2);
      assert.equal(slots.length, n, `${id} × ${n}`);
      const cx = slots.reduce((a, p) => a + p.x, 0) / n, cz = slots.reduce((a, p) => a + p.z, 0) / n;
      assert.ok(Math.abs(cx) < 1e-6 && Math.abs(cz) < 1e-6, `${id} × ${n} centred (${cx}, ${cz})`);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z);
        assert.ok(d > 0.3, `${id} × ${n}: dancers ${i} and ${j} are ${d.toFixed(2)} m apart`);
      }
    }
  }
  // A line is across the stage, a column is in depth, the lead downstage.
  const line = shapeSlots("line", 3, 1);
  assert.deepEqual(line.map((p) => p.z), [0, 0, 0]);
  assert.deepEqual(line.map((p) => p.x).sort((a, b) => a - b), [-1, 0, 1]);
  const col = shapeSlots("column", 3, 1);
  assert.ok(col[0].z > col[1].z && col[1].z > col[2].z);
  // The lead of a circle is nearest the audience.
  const ring = shapeSlots("circle", 6, 1);
  assert.ok(ring.every((p, i) => i === 0 || p.z <= ring[0].z + 1e-9));
});

test("facing rules: audience is 0, centre points home, outward away", () => {
  assert.equal(facingRot("audience", 2, -1), 0);
  assert.equal(facingRot("centre", 0, 0), 0);
  // Standing at +x, facing the centre means facing −x: forward (sin φ, cos φ) = (−1, 0) → φ = −90.
  assert.ok(Math.abs(facingRot("centre", 1, 0) - -90) < 1e-9);
  assert.ok(Math.abs(facingRot("outward", 1, 0) - 90) < 1e-9);
  // Standing downstage (+z) and facing the centre means turning to the back.
  assert.ok(Math.abs(Math.abs(facingRot("centre", 0, 1)) - 180) < 1e-9);
  const ring = formationPlacements({ shape: "circle", spacing: 1, facing: "centre" }, 4);
  for (const p of ring) {
    const phi = (p.rot * Math.PI) / 180;
    // Forward should point at the origin.
    assert.ok(Math.sin(phi) * p.x + Math.cos(phi) * p.z < -0.5, `faces the centre from (${p.x}, ${p.z})`);
  }
});

test("placementsAt holds the first cue, eases between cues, and holds the last", () => {
  const cues: Cue[] = [
    { id: "a", at: 0, shape: "line", spacing: 1, facing: "audience" },
    { id: "b", at: 6, shape: "column", spacing: 1, facing: "audience" },
  ];
  const line = formationPlacements(cues[0], 3), column = formationPlacements(cues[1], 3);
  assert.deepEqual(placementsAt(cues, 3, -1, 2), line);
  assert.deepEqual(placementsAt(cues, 3, 3.9, 2), line);      // the walk starts 2 s before the cue
  assert.deepEqual(placementsAt(cues, 3, 6, 2), column);
  assert.deepEqual(placementsAt(cues, 3, 60, 2), column);
  const mid = placementsAt(cues, 3, 5, 2)!;
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(mid[i].x - (line[i].x + column[i].x) / 2) < 1e-6);
    assert.ok(Math.abs(mid[i].z - (line[i].z + column[i].z) / 2) < 1e-6);
  }
  // Unsorted cues are fine; no cues means no placement.
  assert.deepEqual(placementsAt([cues[1], cues[0]], 3, 60, 2), column);
  assert.equal(placementsAt([], 3, 0), null);
  // A walk never takes longer than the gap between cues.
  const close: Cue[] = [{ ...cues[0] }, { ...cues[1], at: 1 }];
  assert.deepEqual(placementsAt(close, 3, 0, 2), line);
  assert.deepEqual(placementsAt(close, 3, 1, 2), column);
});

test("turns ease the short way round", () => {
  const cues: Cue[] = [
    { id: "a", at: 0, shape: "column", spacing: 1, facing: "audience" },
    { id: "b", at: 2, shape: "column", spacing: 1, facing: "outward" },
  ];
  // The lead (downstage, +z) turns from 0 to face outward = 0 — no turn; the last, upstage, faces the back: ±180.
  const end = placementsAt(cues, 2, 2, 2)!;
  assert.equal(end[0].rot, 0);
  assert.ok(Math.abs(Math.abs(end[1].rot) - 180) < 1e-6);
  const mid = placementsAt(cues, 2, 1, 2)!;
  assert.ok(Math.abs(mid[1].rot) > 0 && Math.abs(mid[1].rot) < 180);
});

test("sanitizeCues repairs stored cues", () => {
  assert.deepEqual(sanitizeCues(null), []);
  const out = sanitizeCues([{ id: "x", at: 3, shape: "zigzag", spacing: 99, facing: "up" }, { at: 1 }, "junk"]);
  assert.deepEqual(out, [{ id: "x", at: 3, shape: "line", spacing: 4, facing: "audience" }]);
});
