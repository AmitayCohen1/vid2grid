"use client";

import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import Figure, { GridSphere } from "./Figure";
import type { Body } from "@/lib/fk";
import type { Pose } from "@/lib/pose";
import type { BoneId } from "@/lib/skeleton";
import type { GridConfig } from "@/lib/grid";

interface Props {
  pose: Pose | null;
  raw: Pose | null;
  body: Body;
  grid: GridConfig;
  showRaw: boolean;
  selected: BoneId | null;
  onSelect: (id: BoneId | null) => void;
}

export default function Stage({ pose, raw, body, grid, showRaw, selected, onSelect }: Props) {
  return (
    <Canvas
      camera={{ position: [1.8, 1.4, 3.2], fov: 45, near: 0.05, far: 100 }}
      onPointerMissed={() => onSelect(null)}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#0b0c0f"]} />
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
      {pose && (
        <>
          <Figure pose={pose} body={body} selected={selected} onSelect={onSelect} />
          {showRaw && raw && <Figure pose={raw} body={body} ghost />}
          {selected && raw && <GridSphere pose={pose} raw={raw} body={body} bone={selected} grid={grid} />}
        </>
      )}
      <OrbitControls target={[0, 0.9, 0]} enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.52} />
    </Canvas>
  );
}
