"use client";

/* ------------------------------------------------------------------
   The kinesphere: Laban's icosahedron drawn around the dancer, with the
   movement grid on its surface and the current notation lit.

   Laban read directions from the body's centre, on the sphere the limbs
   can reach, scaffolded by an icosahedron whose vertices are the corners
   of three golden rectangles — the door (vertical), table (horizontal)
   and wheel (sagittal) planes. three's icosahedron has exactly those
   rectangles in the coordinate planes, so with x across, y up and z
   forward it only needs turning with the dancer.

   On the surface: a dot for every grid cell (azStep × elStep), and for
   each core segment a spoke from the centre to its snapped direction, in
   the segment's side colour. This is the snapped track — what the
   notation reads — never the smooth one.
   ------------------------------------------------------------------ */

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { forwardKinematics, type Body } from "@/lib/fk";
import type { Pose } from "@/lib/pose";
import { BONES, type BoneId } from "@/lib/skeleton";
import { fromAzEl, type Vec3 } from "@/lib/geometry";
import { type GridConfig, cellCounts } from "@/lib/grid";
import { SIDE_COLOURS } from "@/lib/looks";

const CORE = BONES.filter((b) => b.core);
const PHI = (1 + Math.sqrt(5)) / 2;
/** The three golden rectangles of the icosahedron, unit radius: door (xy), table (xz), wheel (yz). */
const PLANES: { colour: string; corners: [number, number, number][] }[] = [
  { colour: "#6f7fa8", corners: [[-1, PHI, 0], [1, PHI, 0], [1, -PHI, 0], [-1, -PHI, 0]] },
  { colour: "#7f9f8a", corners: [[-PHI, 0, -1], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, 1]] },
  { colour: "#a88a6f", corners: [[0, -1, PHI], [0, 1, PHI], [0, 1, -PHI], [0, -1, -PHI]] },
];
const ICO_SCALE = 1 / Math.hypot(1, PHI); // vertices at unit distance

/** Body-local direction → stage direction for a facing, as lib/fk.ts does it. */
function toStage(d: Vec3, facing: number): THREE.Vector3 {
  const phi = facing * (Math.PI / 180);
  const F = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
  const R = new THREE.Vector3(-Math.cos(phi), 0, Math.sin(phi));
  return new THREE.Vector3().addScaledVector(R, d.x).addScaledVector(F, d.z).setY(d.y);
}

interface Props {
  /** The snapped pose (the notation), never the smooth one. */
  pose: Pose;
  body: Body;
  grid: GridConfig;
  selected: BoneId | null;
}

export default function Kinesphere({ pose, body, grid, selected }: Props) {
  const J = useMemo(() => forwardKinematics(pose, body), [pose, body]);
  // Centre of the body; radius the dancer's reach.
  const centre = useMemo(() => new THREE.Vector3((J.hipMid.x + J.shoulderMid.x) / 2, (J.hipMid.y + J.shoulderMid.y) / 2, (J.hipMid.z + J.shoulderMid.z) / 2), [J]);
  const R = body.lengths.luarm + body.lengths.lfarm + body.lengths.lhand + body.shoulderWidth / 2;
  const phi = pose.facing * (Math.PI / 180);

  // Every grid cell as a dot on the sphere, in stage space for this facing.
  const dots = useMemo(() => {
    const n = cellCounts(grid);
    const pts: number[] = [];
    for (let ei = -n.el; ei <= n.el; ei++) {
      const el = ei * grid.elStep;
      const count = Math.abs(ei) === n.el ? 1 : n.az; // one dot at each pole
      for (let ai = 0; ai < count; ai++) {
        const p = toStage(fromAzEl([ai * grid.azStep, el]), pose.facing).multiplyScalar(R);
        pts.push(p.x, p.y, p.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [grid, pose.facing, R]);
  useEffect(() => () => dots.dispose(), [dots]);

  // The lit notation: one spoke per core segment.
  const spokes = useMemo(() => CORE.map((b) => ({
    id: b.id,
    colour: SIDE_COLOURS[b.side],
    tip: toStage(fromAzEl(pose.bones[b.id]), pose.facing).multiplyScalar(R),
  })), [pose, R]);

  return (
    <group position={centre}>
      {/* The scaffold, turned with the dancer. */}
      <group rotation={[0, phi, 0]}>
        <mesh>
          <icosahedronGeometry args={[R, 0]} />
          <meshBasicMaterial color="#8a93a8" wireframe transparent opacity={0.16} depthWrite={false} />
        </mesh>
        {PLANES.map((p, i) => (
          <Line key={i} points={[...p.corners, p.corners[0]].map(([x, y, z]) => [x * ICO_SCALE * R, y * ICO_SCALE * R, z * ICO_SCALE * R] as [number, number, number])}
            color={p.colour} lineWidth={1} transparent opacity={0.45} depthWrite={false} />
        ))}
      </group>
      <points geometry={dots}>
        <pointsMaterial color="#c9d0dd" size={0.02} sizeAttenuation transparent opacity={0.5} depthWrite={false} />
      </points>
      {spokes.map((s) => {
        const hot = selected === s.id;
        return (
          <group key={s.id}>
            <Line points={[[0, 0, 0], [s.tip.x, s.tip.y, s.tip.z]]} color={hot ? "#f0b429" : s.colour} lineWidth={hot ? 2.5 : 1.2} transparent opacity={hot ? 1 : 0.7} depthWrite={false} />
            <mesh position={s.tip}>
              <sphereGeometry args={[hot ? 0.034 : 0.024, 12, 10]} />
              <meshBasicMaterial color={hot ? "#f0b429" : s.colour} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
