"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import Figure, { GridSphere } from "./Figure";
import Avatar from "./Avatar";
import StageEnv from "./StageEnv";
import Backdrop from "./Backdrop";
import Kinesphere from "./Kinesphere";
import { type Body, DEFAULT_BODY, forwardKinematics } from "@/lib/fk";
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
  /** What is drawn behind the figure (lib/backdrops.ts); the stage's own black when absent. */
  backdrop?: string;
  /** Where the camera starts and what it orbits; follows changes. The studio's framing when absent. */
  view?: StageView;
  /** A soft shadow on the floor where the figure touches it. */
  shadow?: boolean;
}

export interface StageView { position: [number, number, number]; target: [number, number, number] }

const DEFAULT_VIEW: StageView = { position: [1.8, 1.4, 3.2], target: [0, 0.9, 0] };

export default function Stage({ pose, raw, body, grid, motion, showRaw, kinesphere = false, avatar, avatarUrl, cast, selected, onSelect, backdrop, view = DEFAULT_VIEW, shadow = false }: Props) {
  const smooth = motion === "smooth" && !!raw;
  const shown = smooth ? raw : pose;      // the figure people watch
  const ghost = smooth ? pose : raw;      // the other one, behind it
  return (
    <Canvas
      camera={{ position: view.position, fov: 45, near: 0.05, far: 100 }}
      onPointerMissed={() => onSelect(null)}
      dpr={[1, 2]}
    >
      <Backdrop id={backdrop} />
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
      <OrbitControls target={view.target} enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.52} />
      <ViewRig view={view} />
      {shadow && shown && <FigureShadow pose={shown} body={body ?? DEFAULT_BODY} />}
    </Canvas>
  );
}

/** Moves the camera when `view` changes after mount (the Canvas only reads its camera prop once). */
function ViewRig({ view }: { view: StageView }) {
  const camera = useThree((s) => s.camera);
  const [x, y, z] = view.position;
  useEffect(() => { camera.position.set(x, y, z); }, [camera, x, y, z]);
  return null;
}

/** Joints within this height of the floor count as touching it. */
const TOUCH = 0.12;

/**
 * Where the figure meets the floor: a soft patch under the body that fades as it rises, and a darker spot
 * under every joint near the floor. Drawn, not cast, since the stick figure's lines throw no shadow map.
 */
function FigureShadow({ pose, body }: { pose: Pose; body: Body }) {
  const blob = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.5, "rgba(0,0,0,.45)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  }, []);
  useEffect(() => () => { blob.dispose(); }, [blob]);
  const J = forwardKinematics(pose, body);
  const joints = Object.values(J);
  const low = joints.filter((j) => j.y < TOUCH);
  return (
    <group position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh position={[pose.x, -pose.z, 0]}>
        <planeGeometry args={[1.1, 1.1]} />
        <meshBasicMaterial map={blob} transparent depthWrite={false} opacity={Math.max(0.12, 0.38 - pose.hipY * 0.2)} />
      </mesh>
      {low.map((j, i) => (
        <mesh key={i} position={[j.x, -j.z, 0.001]}>
          <planeGeometry args={[0.34, 0.34]} />
          <meshBasicMaterial map={blob} transparent depthWrite={false} opacity={0.6 * (1 - j.y / TOUCH)} />
        </mesh>
      ))}
    </group>
  );
}
