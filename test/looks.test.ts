import { test } from "node:test";
import assert from "node:assert/strict";
import { FIGURE_LOOKS, buildLook, figureLook, isLookUrl, lookUrl } from "../lib/looks";
import { AVATAR_PRESETS } from "../lib/avatars";
import { DEFAULT_BODY, forwardKinematics } from "../lib/fk";
import { createDemo } from "../lib/demo";

test("every look builds at a body, places all its parts near the joints, and disposes", () => {
  const score = createDemo("reach");
  for (const look of FIGURE_LOOKS) {
    const rig = buildLook(look, DEFAULT_BODY);
    assert.ok(rig.group.children.length > 10, `${look.id} has parts`);
    for (const pose of [score.frames[0], score.frames[120]]) {
      const J = forwardKinematics(pose, DEFAULT_BODY);
      rig.update(J, pose.facing);
      // Every part sits within the figure's reach of the hips.
      for (const child of rig.group.children) {
        const d = Math.hypot(child.position.x - J.hipMid.x, child.position.y - J.hipMid.y, child.position.z - J.hipMid.z);
        assert.ok(d < 1.6, `${look.id}: a part is ${d.toFixed(2)} m from the hips`);
      }
    }
    rig.dispose();
    assert.equal(rig.group.children.length, 0);
  }
});

test("looks are presets with look: urls, and resolve back", () => {
  for (const look of FIGURE_LOOKS) {
    const url = lookUrl(look.id);
    assert.ok(isLookUrl(url));
    assert.equal(figureLook(url)?.id, look.id);
    const preset = AVATAR_PRESETS.find((a) => a.url === url);
    assert.ok(preset?.look, `${look.id} is in the roster`);
    assert.equal(preset.label, look.label);
  }
  assert.equal(figureLook("/models/avatar.vrm"), undefined);
  assert.equal(isLookUrl(null), false);
});
