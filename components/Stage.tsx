"use client";

import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { Suspense } from "react";
import Figure, { GridSphere } from "./Figure";
import Avatar from "./Avatar";
import StageEnv from "./StageEnv";
import Kinesphere from "./Kinesphere";
import type { Body } from "@/lib/fk";
import type { Pose } from "@/lib/pose";
import type { BoneId } from "@/lib/skeleton";
import type { GridConfig } from "@/lib/grid";

/** A cast dancer ready to draw: pose already sampled at the stage clock,
 *  with its floor placement baked in (facing/x/z transformed) — the
 *  avatar retargeter works in absolute stage directions, so placement
 *  must live in the pose, not in a parent transform. */
export interface StageCastMember {
  id: string;
  pose: Pose;
  body: Body;
  avatarUrl: string | null;
}

interface Props {
  pose: Pose | null;
  raw: Pose | null;
  body: Body | null;
  grid: GridConfig;
  /** Which track drives the figure: the grid-snapped score, or the smooth
   *  tracked motion. The notation is always the snapped one — this is only
   *  what the stage shows. */
  motion: "stepped" | "smooth";
  showRaw: boolean;
  /** Laban's icosahedron around the current dancer, the grid on its surface, the notation lit. */
  kinesphere?: boolean;
  avatar: boolean;
  avatarUrl: string;
  cast: StageCastMember[];
  selected: BoneId | null;
  onSelect: (id: BoneId | null) => void;
}

export default function Stage({ pose, raw, body, grid, motion, showRaw, kinesphere = false, avatar, avatarUrl, cast, selected, onSelect }: Props) {
  const smooth = motion === "smooth" && !!raw;
  const shown = smooth ? raw : pose;      // the figure people watch
  const ghost = smooth ? pose : raw;      // the other one, behind it
  return (
    <Canvas
      camera={{ position: [1.8, 1.4, 3.2], fov: 45, near: 0.05, far: 100 }}
      onPointerMissed={() => onSelect(null)}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#0b0c0f"]} />
      <StageEnv />
      <hemisphereLight args={["#ffffff", "#20232a", 0.9]} />
      <directionalLight position={[3, 5, 4]} intensity={1.1} />
      <directionalLight position={[-3, 2, -2]} intensity={0.4} />
      <Grid
        args={[10, 10]}
        cellSize={0.25}
        cellThickness={0.6}
        cellColor="#262a33"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#3a3f4b"
        fadeDistance={14}
        infiniteGrid
        position={[0, 0, 0]}
      />
      {/* Audience marker: the camera that filmed you sits on +z. */}
      <mesh position={[0, 0.01, 2.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.11, 24]} />
        <meshBasicMaterial color="#f0b429" transparent opacity={0.6} />
      </mesh>
      {shown && body && (
        <>
          {avatar ? (
            <Suspense fallback={null}>
              <Avatar pose={shown} body={body} url={avatarUrl} />
            </Suspense>
          ) : (
            <Figure pose={shown} body={body} selected={selected} onSelect={onSelect} />
          )}
          {showRaw && ghost && <Figure pose={ghost} body={body} ghost />}
          {/* The kinesphere reads the snapped pose whatever the figure is drawn from: it is the notation. */}
          {kinesphere && pose && <Kinesphere pose={pose} body={body} grid={grid} selected={selected} />}
          {/* The sphere always compares the true snapped/raw pair, whichever is on stage. */}
          {selected && pose && raw && <GridSphere pose={pose} raw={raw} body={body} bone={selected} grid={grid} />}
        </>
      )}
      {cast.map((m) =>
        m.avatarUrl ? (
          <Suspense key={m.id} fallback={null}>
            <Avatar pose={m.pose} body={m.body} url={m.avatarUrl} instanceKey={m.id} />
          </Suspense>
        ) : (
          <Figure key={m.id} pose={m.pose} body={m.body} />
        ),
      )}
      <OrbitControls target={[0, 0.9, 0]} enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.52} />
    </Canvas>
  );
}
