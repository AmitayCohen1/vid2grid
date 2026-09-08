"use client";

/* ------------------------------------------------------------------
   The landing hero: a real clip and a character dancing its score.

   `/demo/alice.json` is the app's own output for `/demo/alice.mp4`
   (poses + per-frame picture anchors, produced by the offline pipeline
   in lib/tracker → lib/score → lib/invideo). The picture sits at the
   left of a black stage; the character stands to its right on the
   dancer's own floor, drawn by the same orthographic recipe as the
   in-video figures (lib/invideo.ts): the picture is `mpu` metres wide,
   so metres and pixels are one scale for both of them. The <video>'s
   clock is the stage clock, exactly as in the studio.
   ------------------------------------------------------------------ */

import { Canvas, useFrame } from "@react-three/fiber";
import { type ReactNode, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OrthographicCamera } from "three";
import Avatar from "./Avatar";
import { imageToWorld } from "@/lib/invideo";
import { scaleBody } from "@/lib/devices";
import type { Body } from "@/lib/fk";
import type { Pose } from "@/lib/pose";
import type { SourceInfo } from "@/lib/score";

interface HeroData {
  source: SourceInfo;
  body: Body;
  raw: Pose[];
  /** Per frame: [hip u across the picture, floor v down the picture, metres the picture spans]. */
  anchors: [number, number, number][];
}

interface Rect { x: number; y: number; w: number; h: number }

/** How much bigger than life the character is drawn on the wide layout. Display only. */
const SIZE = 1.15;
/** The picture is at most this share of the stage width (wide / narrow), and at most this tall. */
const PICTURE = 0.56, PICTURE_NARROW = 0.55;
const MAX_HEIGHT = 600;
/** The slice of the frame shown, fractions across, for clips whose sides the dancer never uses. */
const CROP = { l: 0, r: 1 };
const SPAN = CROP.r - CROP.l;
/** Wide layouts wider than this also carry the cast picker (`children`) at the stage's right edge. */
const CAST_FROM = 720;

export default function HeroDuet({ avatarUrl, children }: { avatarUrl: string; children?: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const castRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [data, setData] = useState<HeroData | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [castWidth, setCastWidth] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/demo/alice.json").then((r) => r.json()).then((d: HeroData) => { if (alive) setData(d); }).catch(() => { /* the video still plays */ });
    return () => { alive = false; };
  }, []);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => { setWidth(el.clientWidth); setCastWidth(castRef.current?.offsetWidth ?? 0); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (castRef.current) ro.observe(castRef.current);
    return () => ro.disconnect();
  }, [width]);

  const aspect = (data ? data.source.width / data.source.height : 720 / 1088) * SPAN;
  // The picture takes the left of the stage and the character has the rest; a portrait
  // clip keeps that even on a phone. A landscape clip on a phone is the whole stage and
  // the character stands inside it. The stage is exactly as tall as the picture.
  const wide = !!width && (width >= 720 || aspect < 1);
  const rect: Rect | null = useMemo(() => {
    if (!width) return null;
    const share = width >= 720 ? PICTURE : PICTURE_NARROW;
    const w = wide ? Math.min(width * share, MAX_HEIGHT * aspect) : width;
    return { x: 0, y: 0, w, h: w / aspect };
  }, [width, wide, aspect]);
  const box = width && rect ? { W: width, H: rect.h } : null;

  return (
    <div ref={boxRef} className="duet" style={{ height: rect?.h }} aria-label="A dancer on video, and a character dancing the same score beside them">
      {rect && (
        <div className="duet-picture" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
          <video ref={videoRef} className="duet-video" src="/demo/alice.mp4" poster="/demo/alice.jpg" muted loop autoPlay playsInline preload="auto"
            style={{ left: -CROP.l * rect.w / SPAN, width: rect.w / SPAN, height: rect.h }} />
        </div>
      )}
      {rect && data && box && (
        <div className="duet-canvas">
          <Canvas orthographic camera={{ position: [0, 0, 10], near: 0.1, far: 100 }} gl={{ alpha: true, antialias: true }} style={{ background: "transparent" }} dpr={[1, 2]}>
            <hemisphereLight args={["#ffffff", "#20232a", 0.9]} />
            <directionalLight position={[3, 5, 6]} intensity={1.1} />
            <directionalLight position={[-3, 2, 2]} intensity={0.4} />
            <Duet data={data} rect={rect} box={box} wide={wide} castWidth={castWidth} videoRef={videoRef} avatarUrl={avatarUrl} />
          </Canvas>
        </div>
      )}
      {width !== null && width >= CAST_FROM && children && <div ref={castRef} className="duet-cast">{children}</div>}
    </div>
  );
}

/** Reads the video clock each frame, places the character, keeps the camera at picture scale. */
function Duet({ data, rect, box, wide, castWidth, videoRef, avatarUrl }: {
  data: HeroData; rect: Rect; box: { W: number; H: number }; wide: boolean; castWidth: number;
  videoRef: React.RefObject<HTMLVideoElement | null>; avatarUrl: string;
}) {
  const [fi, setFi] = useState(0);
  const n = data.raw.length;
  const aspect = (data.source.width / data.source.height) * SPAN;
  // The dancer's average spot, so the character's travel is theirs but centred in its own column.
  const meanX = useMemo(() => data.raw.reduce((a, p) => a + p.x, 0) / Math.max(1, n), [data, n]);

  useFrame(({ camera, size }) => {
    const v = videoRef.current;
    if (!v) return;
    const i = Math.max(0, Math.min(n - 1, Math.round(v.currentTime * data.source.fps)));
    if (i !== fi) setFi(i);
    // Pixels per metre: the frame is `mpu` metres wide, the picture is its cropped slice.
    const mpu = (data.anchors[i]?.[2] ?? data.anchors[0][2]) * SPAN;
    const cam = camera as OrthographicCamera;
    const zoom = (rect.w / mpu) * (size.width / box.W);
    if (Math.abs(cam.zoom - zoom) > 1e-6) { cam.zoom = zoom; cam.updateProjectionMatrix(); }
  });

  const [fullU, floorV, fullMpu] = data.anchors[fi] ?? data.anchors[0];
  const u = (fullU - CROP.l) / SPAN, mpu = fullMpu * SPAN; // in the cropped picture
  const k = mpu / rect.w; // metres per pixel
  // Picture centre, in stage metres from the stage centre.
  const cx = (rect.x + rect.w / 2 - box.W / 2) * k;
  const cy = -(rect.y + rect.h / 2 - box.H / 2) * k;
  const at = imageToWorld(u, floorV, mpu, aspect);
  const p = data.raw[fi];
  const size = wide && box.W >= 720 ? SIZE : 0.92;
  // Wide: centred in the band between the picture and the cast picker, feet on the dancer's
  // floor, its own travel halved. Narrow: beside the dancer inside the picture, like Compare.
  const columnX = wide ? ((rect.x + rect.w + box.W - castWidth) / 2 - box.W / 2) * k : cx + at.x + 1.1;
  const pose: Pose = { ...p, x: columnX + (wide ? (p.x - meanX) * 0.5 : 0), z: 0, hipY: cy + at.y + p.hipY * size };
  const body = useMemo(() => scaleBody(data.body, size), [data.body, size]);

  return (
    <Suspense fallback={null}>
      <Avatar pose={pose} body={body} url={avatarUrl} instanceKey="hero" />
    </Suspense>
  );
}
