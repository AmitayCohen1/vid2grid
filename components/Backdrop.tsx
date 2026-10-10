"use client";

import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { Environment, useTexture } from "@react-three/drei";
import { backdropById, DEFAULT_BACKDROP } from "@/lib/backdrops";

/**
 * What the stage draws behind the figure (lib/backdrops.ts). Places are
 * shown as the background only, so the lighting and StageEnv's reflections
 * are the same whatever is chosen; made backdrops are a colour, a gradient
 * texture, or a dark floor with a pool of light. Fog in the backdrop's floor
 * colour fades the grid out before the horizon.
 */
export default function Backdrop({ id }: { id?: string }) {
  if (!id) return <color attach="background" args={[DEFAULT_BACKDROP.colour]} />;
  const b = backdropById(id);
  switch (b.kind) {
    case "colour":
      return <><color attach="background" args={[b.colour]} /><fog attach="fog" args={[b.colour, 7, 18]} /></>;
    case "gradient":
      return <><Gradient b={b} /><fog attach="fog" args={[b.bottom, 7, 18]} /></>;
    case "spotlight":
      return <><color attach="background" args={[b.colour]} /><fog attach="fog" args={[b.colour, 3, 8]} /><LightPool colour={b.light} /></>;
    case "floor":
      return <><Gradient b={b} /><fog attach="fog" args={[b.bottom, 6, 16]} /><Suspense fallback={null}><FloorPicture {...b.floor} /></Suspense></>;
    case "place":
      return <Suspense fallback={null}><Environment files={b.file} background="only" /></Suspense>;
  }
}

function Gradient({ b }: { b: { top: string; bottom: string } }) {
  const texture = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = 2; cv.height = 256;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, b.top); g.addColorStop(1, b.bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 256);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [b.top, b.bottom]);
  useEffect(() => () => { texture.dispose(); }, [texture]);
  return <primitive attach="background" object={texture} />;
}

/** A soft round pool of light on the floor under the dancer. */
function LightPool({ colour }: { colour: string }) {
  const texture = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255,255,255,.55)"); g.addColorStop(0.45, "rgba(255,255,255,.22)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(cv);
  }, []);
  useEffect(() => () => { texture.dispose(); }, [texture]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
      <planeGeometry args={[4.5, 4.5]} />
      <meshBasicMaterial map={texture} color={colour} transparent depthWrite={false} fog={false} />
    </mesh>
  );
}

/** A picture lying on the floor, `w` × `d` metres, its top edge away from the audience. */
function FloorPicture({ src, w, d, x, z }: { src: string; w: number; d: number; x: number; z: number }) {
  const map = useTexture(src, (t) => { t.colorSpace = THREE.SRGBColorSpace; });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.001, z]}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial map={map} toneMapped={false} />
    </mesh>
  );
}
