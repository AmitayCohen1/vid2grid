"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * A neutral room as the scene's environment, so chrome and glass looks
 * (lib/looks.ts) have something to reflect. Built from three's bundled
 * RoomEnvironment — no file to fetch — and attached declaratively.
 * Toon-shaded VRM characters ignore it; the stick figure barely notices.
 */
export default function StageEnv() {
  const gl = useThree((s) => s.gl);
  const texture = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const t = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return t;
  }, [gl]);
  useEffect(() => () => { texture.dispose(); }, [texture]);
  return <primitive attach="environment" object={texture} />;
}
