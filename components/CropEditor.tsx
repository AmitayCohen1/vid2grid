"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Focus, Pause, Play, RotateCcw, Users, X } from "lucide-react";
import { type Crop, FULL_CROP, type Handle, MIN_CROP, clampCrop, cropZoom, isFullCrop, moveCrop, resizeCrop, zoomCrop } from "@/lib/crop";
import { type Anchor, type PersonPick, anchorOf, pickAnchor } from "@/lib/follow";
import { MAX_PEOPLE, detectPeople, fitCropToDancer } from "@/lib/tracker";
import { describeError } from "@/lib/errors";

interface Props {
  src: string;
  crop: Crop;
  onChange: (crop: Crop) => void;
  /** Who to follow when several people are in frame, one dancer each; empty = the biggest body. */
  picks: PersonPick[];
  onPicks: (picks: PersonPick[]) => void;
  onMeta?: (video: HTMLVideoElement) => void;
  onError?: () => void;
  /** Rendered at the top of the side column, above the framing tools. */
  head?: React.ReactNode;
  /** Rendered at the bottom of the side column, below the framing tools. */
  children?: React.ReactNode;
}

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MAX_ZOOM = 1 / MIN_CROP;

/** A pick refers to the moment it was made; this close to it the boxes show who was picked. */
const PICK_TIME_TOLERANCE = 0.3;

/**
 * Frame the dancers before tracking: drag the box to move it, drag its
 * edges to resize, scroll or use the slider to zoom, or let the tracker
 * find them. The crop is what the tracker sees and what the studio shows.
 * When the paused frame holds more than one person, each gets a box;
 * clicking one says "follow this dancer", and every one clicked becomes
 * a dancer of their own.
 */
export default function CropEditor({ src, crop, onChange, picks, onPicks, onMeta, onError, head, children }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  /* The frame fills the room it is given, keeping the clip's aspect exactly (the box maps to it 1:1). */
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = roomRef.current;
    if (!el) return;
    const measure = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const frameW = Math.max(0, Math.floor(Math.min(room.w, room.h * aspect)));
  const frameH = Math.max(0, Math.floor(frameW / aspect));
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fitting, setFitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Person detection outlives the editor otherwise: on a first visit the tracker may still be downloading when the clip is confirmed. */
  const peopleAbort = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); peopleAbort.current?.abort(); }, []);

  /* ---------- who is in the paused frame ---------- */
  const [people, setPeople] = useState<Anchor[]>([]);
  const peopleRun = useRef(0);
  /** Fit to dancer seeks the same video; its seeks must not be mistaken for the user pausing on a frame. */
  const fittingRef = useRef(false);
  const findPeople = useCallback(() => {
    const v = videoRef.current;
    const run = ++peopleRun.current;
    if (!v || v.readyState < 2 || !v.paused || fittingRef.current) return;
    // Let the seek settle: a burst of scrubbing only detects on the last frame.
    setTimeout(async () => {
      if (run !== peopleRun.current || fittingRef.current) return;
      peopleAbort.current?.abort();
      const ac = new AbortController();
      peopleAbort.current = ac;
      try {
        const found = await detectPeople(v, ac.signal);
        if (ac.signal.aborted || run !== peopleRun.current || !v.paused) return;
        setPeople(found.map((b) => anchorOf(b)).filter((a): a is Anchor => !!a));
      } catch (e) {
        if (ac.signal.aborted) return;
        // The boxes are a convenience; tracking itself reports a broken tracker.
        console.warn("detectPeople failed", e);
      }
    }, 120);
  }, []);
  const clearPeople = () => { peopleRun.current++; peopleAbort.current?.abort(); setPeople([]); };

  /* ---------- pointer: move and resize ---------- */
  const drag = useRef<{ handle: Handle | "move"; start: Crop; x: number; y: number } | null>(null);
  const toFrac = (e: { clientX: number; clientY: number }) => {
    const r = frameRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onDown = (e: React.PointerEvent, handle: Handle | "move") => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toFrac(e);
    drag.current = { handle, start: crop, x: p.x, y: p.y };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toFrac(e);
    const dx = p.x - d.x, dy = p.y - d.y;
    onChange(d.handle === "move" ? moveCrop(d.start, dx, dy) : resizeCrop(d.start, d.handle, dx, dy));
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  /* ---------- wheel: zoom about the pointer (non-passive, so the dialog doesn't scroll) ---------- */
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const anchor = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      onChange(zoomCrop(crop, cropZoom(crop) * factor, anchor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [crop, onChange]);

  /* ---------- playback ---------- */
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {}); else v.pause();
  };
  const scrub = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = t;
    setTime(t);
  };

  /* ---------- fit to dancer ---------- */
  const fit = useCallback(async () => {
    const v = videoRef.current;
    if (!v || fitting) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setFitting(true); setNote(null);
    fittingRef.current = true; clearPeople();
    try {
      const found = await fitCropToDancer(v, { follow: picks, signal: ac.signal });
      if (ac.signal.aborted) return;
      if (!found) setNote(picks.length ? "Couldn't follow the dancers you chose. Pick them again on a frame where their whole bodies are clear." : "No one was found in the clip. Frame the dancer by hand, or try another clip.");
      else onChange(found);
    } catch (e) {
      if (!ac.signal.aborted) setNote(describeError(e));
    } finally {
      fittingRef.current = false;
      if (!ac.signal.aborted) { setFitting(false); findPeople(); }
    }
  }, [fitting, onChange, picks, findPeople]);

  const zoom = cropZoom(crop);
  const full = isFullCrop(crop);
  const showPeople = people.length > 1 || (picks.length > 0 && people.length > 0);
  /* Which box each pick made around this moment lands on, so a click on it takes that pick back. */
  const pickOf = new Map<number, number>();
  picks.forEach((p, k) => {
    if (Math.abs(time - p.t) >= PICK_TIME_TOLERANCE) return;
    const i = pickAnchor(people, p);
    if (i >= 0 && !pickOf.has(i)) pickOf.set(i, k);
  });
  const atLimit = picks.length >= MAX_PEOPLE;
  const choose = (a: Anchor, i: number) => {
    const v = videoRef.current;
    if (!v) return;
    const k = pickOf.get(i);
    if (k !== undefined) onPicks(picks.filter((_, j) => j !== k));
    else if (!atLimit) onPicks([...picks, { x: a.x, y: a.y, t: v.currentTime }]);
  };
  /** Everyone in this frame, each a dancer, numbered left to right (the leftmost leads). */
  const chooseAll = () => {
    const v = videoRef.current;
    if (!v) return;
    onPicks([...people].sort((a, b) => a.x - b.x).slice(0, MAX_PEOPLE).map((a) => ({ x: a.x, y: a.y, t: v.currentTime })));
  };
  const nth = (k: number) => k + 1;

  return (
    <div className="crop-editor">
      <div className="crop-stage">
      <div ref={roomRef} className="crop-room">
      <div ref={frameRef} className="crop-frame" data-people={people.length} style={{ width: frameW || undefined, height: frameH || undefined }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <video
          ref={videoRef}
          src={src}
          playsInline
          muted
          preload="metadata"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
            if (Number.isFinite(v.duration)) setDuration(v.duration);
            onMeta?.(v);
          }}
          onDurationChange={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration); }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedData={findPeople}
          onSeeked={findPeople}
          onPlay={() => { setPlaying(true); clearPeople(); }}
          onPause={() => { setPlaying(false); findPeople(); }}
          onError={onError}
        />
        <div
          className="crop-box"
          role="group"
          aria-label="Crop region"
          style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
          onPointerDown={(e) => onDown(e, "move")}
        >
          {HANDLES.map((h) => <span key={h} className={`crop-handle crop-${h}`} onPointerDown={(e) => onDown(e, h)} />)}
          <span className="crop-zoom mono">{full ? "FULL FRAME" : `${zoom.toFixed(1)}×`}</span>
        </div>
        {showPeople && people.map((a, i) => {
          const k = pickOf.get(i);
          const on = k !== undefined;
          return (
            <button
              key={i}
              type="button"
              className={`person-box ${on ? "is-picked" : ""} ${a.box.y < 0.08 ? "is-high" : ""}`}
              style={{ left: `${a.box.x * 100}%`, top: `${a.box.y * 100}%`, width: `${a.box.w * 100}%`, height: `${a.box.h * 100}%` }}
              aria-label={on ? `Dancer ${nth(k)} — click to stop following` : atLimit ? `Up to ${MAX_PEOPLE} dancers` : "Follow this dancer"}
              aria-pressed={on}
              disabled={!on && atLimit}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => choose(a, i)}
            >
              <span className="person-tag mono">{on ? (picks.length > 1 ? `DANCER ${nth(k)}` : "FOLLOWING") : "FOLLOW"}</span>
            </button>
          );
        })}
        {fitting && <div className="crop-fitting" role="status">Finding the dancer…</div>}
      </div>
      </div>
      <div className="crop-tools">
        <button type="button" className="btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"} disabled={!duration}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <input type="range" aria-label="Scrub the clip" min={0} max={Math.max(0.01, duration)} step={0.01} value={Math.min(time, duration || 0)} onChange={(e) => scrub(Number(e.target.value))} disabled={!duration} />
        <span className="crop-time mono">{time.toFixed(1)} / {duration.toFixed(1)} s</span>
      </div>
      {(showPeople || picks.length > 0) && <div className="crop-people">
        {picks.length > 1
          ? <><span>Following {picks.length} dancers — each gets their own dance{people.length > pickOf.size && !atLimit ? "; click another to add them" : ""}.</span><button type="button" className="btn" onClick={() => onPicks([])} aria-label="Stop following these dancers"><X size={14} /> Clear</button></>
          : picks.length === 1
          ? <><span>Following the dancer you chose at {picks[0].t.toFixed(1)} s{people.length > 1 ? " — click someone else to follow them too" : ""}.</span><button type="button" className="btn" onClick={() => onPicks([])} aria-label="Stop following this dancer"><X size={14} /> Clear</button></>
          : <><span>{people.length} people in this frame — click each dancer to follow; the biggest body is followed otherwise.</span><button type="button" className="btn" onClick={chooseAll}><Users size={14} /> Follow all {Math.min(people.length, MAX_PEOPLE)}</button></>}
      </div>}
      </div>
      <div className="crop-side">
        {head}
        <div className="crop-tools crop-tools-zoom">
          <label className="crop-zoom-slider"><span>Zoom</span><input type="range" aria-label="Zoom" min={1} max={MAX_ZOOM} step={0.05} value={zoom} onChange={(e) => onChange(zoomCrop(crop, Number(e.target.value)))} /><span className="mono crop-zoom-value">{full ? "full" : `${zoom.toFixed(1)}×`}</span></label>
        </div>
        <div className="crop-tools">
          <button type="button" className="btn" onClick={fit} disabled={fitting || !duration}><Focus size={15} /> Fit to dancer</button>
          <button type="button" className="btn" onClick={() => onChange(clampCrop(FULL_CROP))} disabled={full} aria-label="Reset crop" title="Reset to the full frame"><RotateCcw size={15} /></button>
        </div>
        {note && <p role="alert" className="inline-error">{note}</p>}
        {children}
      </div>
    </div>
  );
}
