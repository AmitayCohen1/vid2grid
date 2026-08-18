"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { forwardKinematics, type Body } from "@/lib/fk";
import type { Pose } from "@/lib/pose";
import { BONE, BONES, type BoneId } from "@/lib/skeleton";
import { fromAzEl } from "@/lib/geometry";
import type { GridConfig } from "@/lib/grid";
import { cellToAzEl, nearestCell } from "@/lib/grid";

const UP = new THREE.Vector3(0, 1, 0);
const COLORS = { L: "#4cc9f0", R: "#f72585", C: "#b8c0d0" };

interface Props {
  pose: Pose;
  body: Body;
  /** Ghost figures are the raw evidence: thin and translucent. */
  ghost?: boolean;
  selected?: BoneId | null;
  onSelect?: (id: BoneId) => void;
}

export default function Figure({ pose, body, ghost = false, selected, onSelect }: Props) {
  const J = useMemo(() => forwardKinematics(pose, body), [pose, body]);
  const radius = ghost ? 0.012 : 0.028;

  return (
    <group>
      {/* Hip line */}
      <Segment a={J.lhip} b={J.rhip} radius={radius} color={COLORS.C} ghost={ghost} />
      {BONES.map((b) => {
        const a = J[b.from];
        const c = J[b.to];
        const isSel = selected === b.id;
        return (
          <Segment
            key={b.id}
            a={a}
            b={c}
            radius={b.core ? radius : radius * 0.7}
            color={isSel ? "#f0b429" : COLORS[b.side]}
            ghost={ghost}
            onClick={onSelect ? () => onSelect(b.id) : undefined}
          />
        );
      })}
      {!ghost &&
        (Object.keys(J) as (keyof typeof J)[]).map((k) => (
          <mesh key={k} position={[J[k].x, J[k].y, J[k].z]}>
            <sphereGeometry args={[radius * 1.35, 12, 12]} />
            <meshStandardMaterial color="#e8e9ec" />
          </mesh>
        ))}
      {!ghost && (
        <mesh position={[J.headTop.x, J.headTop.y + 0.02, J.headTop.z]}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshStandardMaterial color="#e8e9ec" />
        </mesh>
      )}
    </group>
  );
}

function Segment({
  a, b, radius, color, ghost, onClick,
}: { a: THREE.Vector3Like; b: THREE.Vector3Like; radius: number; color: string; ghost: boolean; onClick?: () => void }) {
  const { pos, quat, length } = useMemo(() => {
    const va = new THREE.Vector3(a.x, a.y, a.z);
    const vb = new THREE.Vector3(b.x, b.y, b.z);
    const dir = vb.clone().sub(va);
    const length = Math.max(1e-4, dir.length());
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    const pos = va.clone().add(vb).multiplyScalar(0.5);
    return { pos, quat, length };
  }, [a, b]);
  return (
    <mesh position={pos} quaternion={quat} onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}>
      <cylinderGeometry args={[radius, radius, length, 10]} />
      <meshStandardMaterial color={color} transparent={ghost} opacity={ghost ? 0.35 : 1} roughness={0.6} />
    </mesh>
  );
}

/**
 * The grid made visible: a wire sphere at the root of the selected segment,
 * meshed at the grid step, with the snapped direction (solid) and raw
 * direction (hollow) marked.
 */
export function GridSphere({
  pose, raw, body, bone, grid,
}: { pose: Pose; raw: Pose; body: Body; bone: BoneId; grid: GridConfig }) {
  const J = useMemo(() => forwardKinematics(pose, body), [pose, body]);
  const b = BONE[bone];
  const origin = J[b.from];
  const L = body.lengths[bone] ?? b.len;
  const phi = pose.facing * (Math.PI / 180);
  const toStage = (v: { x: number; y: number; z: number }) => {
    const F = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
    const R = new THREE.Vector3(-Math.cos(phi), 0, Math.sin(phi));
    return new THREE.Vector3().addScaledVector(R, v.x).addScaledVector(UP, v.y).addScaledVector(F, v.z);
  };
  const snapped = toStage(fromAzEl(cellToAzEl(grid, nearestCell(grid, pose.bones[bone])))).multiplyScalar(L);
  const rawDir = toStage(fromAzEl(raw.bones[bone])).multiplyScalar(L);
  const wSeg = Math.round(360 / grid.azStep);
  const hSeg = Math.round(180 / grid.elStep);
  return (
    <group position={[origin.x, origin.y, origin.z]}>
      {/* Wireframe sphere aligned with the dancer's facing. */}
      <mesh rotation={[0, phi, 0]}>
        <sphereGeometry args={[L, wSeg, hSeg]} />
        <meshBasicMaterial color="#f0b429" wireframe transparent opacity={0.22} />
      </mesh>
      <mesh position={snapped}>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshBasicMaterial color="#f0b429" />
      </mesh>
      <mesh position={rawDir}>
        <sphereGeometry args={[0.022, 12, 12]} />
        <meshBasicMaterial color="#ffffff" wireframe />
      </mesh>
    </group>
  );
}
