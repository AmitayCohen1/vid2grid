import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_DEVICES, clipTime, memberSpan, mirrorBody, mirrorPose, placePose, sanitizeDevices, scaleBody, scalePose } from "../lib/devices";
import { forwardKinematics, DEFAULT_BODY } from "../lib/fk";
import { BONE_IDS } from "../lib/skeleton";
import type { Pose } from "../lib/pose";
import type { AzEl } from "../lib/geometry";

function pose(over: Partial<Record<(typeof BONE_IDS)[number], AzEl>> = {}, facing = 30): Pose {
  const bones = Object.fromEntries(BONE_IDS.map((id) => [id, over[id] ?? [0, -80] as AzEl])) as Pose["bones"];
  bones.torso = [0, 88]; bones.head = [0, 85]; bones.shoulders = [90, 0];
  return { t: 0, facing, x: 0.4, z: -0.2, hipY: 0.95, bones, conf: 1 };
}

test("clipTime: waits through the delay, runs at rate, holds at the end, reverses", () => {
  assert.equal(clipTime(0.5, 10, { ...NO_DEVICES, delay: 1 }), 0);
  assert.equal(clipTime(3, 10, { ...NO_DEVICES, delay: 1 }), 2);
  assert.equal(clipTime(3, 10, { ...NO_DEVICES, delay: 1, rate: 2 }), 4);
  assert.equal(clipTime(30, 10, { ...NO_DEVICES, delay: 1 }), 10);
  assert.equal(clipTime(0, 10, { ...NO_DEVICES, reverse: true }), 10);
  assert.equal(clipTime(4, 10, { ...NO_DEVICES, reverse: true }), 6);
  assert.equal(memberSpan(10, { ...NO_DEVICES, delay: 1.5, rate: 0.5 }), 21.5);
});

test("sanitizeDevices fills and clamps", () => {
  assert.deepEqual(sanitizeDevices(undefined), NO_DEVICES);
  assert.deepEqual(sanitizeDevices({ delay: -3, rate: 99, mirror: true }), { delay: 0, rate: 4, mirror: true, reverse: false, size: 1 });
  assert.equal(sanitizeDevices({ size: 7 }).size, 2);
});

test("scaleBody and scalePose keep the feet on the floor", () => {
  const b = scaleBody(DEFAULT_BODY, 2);
  assert.equal(b.lengths.lshin, DEFAULT_BODY.lengths.lshin * 2);
  assert.equal(b.hipWidth, DEFAULT_BODY.hipWidth * 2);
  assert.equal(scaleBody(DEFAULT_BODY, 1), DEFAULT_BODY);
  const p = scalePose({ ...pose({}), hipY: 0.9, x: 1.5 }, 2);
  assert.equal(p.hipY, 1.8);
  assert.equal(p.x, 1.5);
});

test("mirrorPose is the audience's mirror image of the figure", () => {
  // Right arm out to the dancer's right, left arm forward-up.
  const p = pose({ ruarm: [90, 0], rfarm: [90, 0], luarm: [0, 45], lfarm: [0, 45] });
  const m = mirrorPose(p);
  const J = forwardKinematics(p, DEFAULT_BODY), M = forwardKinematics(m, DEFAULT_BODY);
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  // Every joint's mirror image is the opposite joint of the mirrored figure.
  near(M.lwrist.x, -J.rwrist.x); near(M.lwrist.y, J.rwrist.y); near(M.lwrist.z, J.rwrist.z);
  near(M.rwrist.x, -J.lwrist.x); near(M.rwrist.y, J.lwrist.y); near(M.rwrist.z, J.lwrist.z);
  near(M.lshoulder.x, -J.rshoulder.x); near(M.rshoulder.z, J.lshoulder.z);
  near(M.headTop.x, -J.headTop.x); near(M.headTop.y, J.headTop.y);
  // Twice is the identity.
  const back = mirrorPose(m);
  const B = forwardKinematics(back, DEFAULT_BODY);
  near(B.rwrist.x, J.rwrist.x); near(B.lwrist.z, J.lwrist.z); near(back.facing, p.facing);
});

test("mirrorBody swaps the limb lengths", () => {
  const b = { ...DEFAULT_BODY, lengths: { ...DEFAULT_BODY.lengths, ruarm: 0.3, luarm: 0.2 } };
  const m = mirrorBody(b);
  assert.equal(m.lengths.ruarm, 0.2); assert.equal(m.lengths.luarm, 0.3); assert.equal(m.lengths.torso, b.lengths.torso);
});

test("placePose turns the travel with the facing and shifts it", () => {
  const p = pose({}, 0);
  const q = placePose({ ...p, x: 1, z: 0 }, { x: 0.5, z: 0.25, rot: 90 });
  assert.equal(q.facing, 90);
  assert.ok(Math.abs(q.x - 0.5) < 1e-9 && Math.abs(q.z - (0.25 - 1)) < 1e-9);
});
