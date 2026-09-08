"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useLayoutEffect, useRef, useState } from "react";
import type { OrthographicCamera } from "three";
import Figure from "./Figure";
import Avatar from "./Avatar";
import type { StageCastMember } from "./Stage";

interface Props {
  /** Width / height of the picture (the tracked crop), so the overlay letterboxes exactly like the video. */
  aspect: number;
  /** Metres the picture spans at the person's depth — the orthographic camera's width. */
  metresAcross: number;
  /** Figures already placed in picture metres (origin at the centre, y up). */
  figures: StageCastMember[];
}

/**
 * Figures drawn inside the video: a transparent orthographic scene laid
 * over the picture, scaled so its width is the metres the picture spans
 * at the person's depth. The poses arrive already anchored beside the
 * person (see lib/invideo.ts); this only draws them at that scale.
 */
export default function VideoStage({ aspect, metresAcross, figures }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // The picture's letterbox inside the pane — the same fit VideoPane makes.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      const W = box.clientWidth, H = box.clientHeight;
      if (!W || !H) return;
      let w = W, h = W / aspect;
      if (h > H) { h = H; w = H * aspect; }
      setRect({ x: (W - w) / 2, y: (H - h) / 2, w, h });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [aspect]);

  return (
    <div ref={boxRef} className="absolute inset-0 pointer-events-none">
      {rect && figures.length > 0 && (
        <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
          <Canvas
            orthographic
            camera={{ position: [0, 0, 10], near: 0.1, far: 100 }}
            gl={{ alpha: true, antialias: true }}
            style={{ background: "transparent" }}
            dpr={[1, 2]}
          >
            <FitWidth metres={metresAcross} />
            <hemisphereLight args={["#ffffff", "#20232a", 0.9]} />
            <directionalLight position={[3, 5, 6]} intensity={1.1} />
            <directionalLight position={[-3, 2, 2]} intensity={0.4} />
            {figures.map((m) =>
              m.avatarUrl ? (
                <Suspense key={m.id} fallback={null}>
                  <Avatar pose={m.pose} body={m.body} url={m.avatarUrl} instanceKey={`${m.id}:video`} />
                </Suspense>
              ) : (
                <Figure key={m.id} pose={m.pose} body={m.body} />
              ),
            )}
          </Canvas>
        </div>
      )}
    </div>
  );
}

/** Keep the camera exactly `metres` wide, whatever the canvas size. */
function FitWidth({ metres }: { metres: number }) {
  useFrame(({ camera, size }) => {
    const cam = camera as OrthographicCamera;
    const zoom = size.width / Math.max(0.5, metres);
    if (Math.abs(cam.zoom - zoom) > 1e-6) { cam.zoom = zoom; cam.updateProjectionMatrix(); }
  });
  return null;
}
