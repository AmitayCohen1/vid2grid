"use client";

import { Check, Trash2 } from "lucide-react";
import { LIVE_MAX_SECONDS } from "@/lib/capture";
import { CORE_BONES, type FrameMatch, GOOD, grade } from "@/lib/match";
import { BONE } from "@/lib/skeleton";

interface Props {
  /** Seconds since the take began. */
  elapsed: number;
  keyframes: number;
  /** The body has been measured and the stage is drawing. */
  ready: boolean;
  finishing: boolean;
  /** Dance-along: this moment's match, the running mean, and whether the target dance is over. */
  match?: { now: FrameMatch | null; mean: number; over: boolean } | null;
  onFinish: () => void;
  onDiscard: () => void;
}

/** The transport while a take is live: no playhead, just the clock and how to end it. */
export default function LiveBar({ elapsed, keyframes, ready, finishing, match, onFinish, onDiscard }: Props) {
  const left = Math.max(0, LIVE_MAX_SECONDS - elapsed);
  return (
    <div className="transport live-bar flex items-center gap-2 text-xs select-none" role="status" aria-live="off">
      <span className="live-pill mono"><span className="live-dot" aria-hidden="true" />LIVE</span>
      {match && <span className="along-meter" title="How closely your limbs match the dance right now (bars: torso, head, arms, legs), and the running score">
        <b className="mono">{Math.round(match.mean * 100)}%</b>
        <span className="along-bars" aria-hidden="true">
          {CORE_BONES.map((id) => { const v = match.now?.bones[id] ?? 0; return <i key={id} title={BONE[id].label} style={{ height: `${Math.max(12, v * 100)}%` }} className={v >= GOOD ? "is-good" : ""} />; })}
        </span>
        <small>{match.over ? "The dance is over — finish the take" : match.now ? grade(match.now.score) : "waiting for you"}</small>
      </span>}
      <span className="transport-time mono text-muted-foreground">
        <span className="text-foreground">{elapsed.toFixed(1)}</span> s <span className="transport-detail">· {ready ? `${keyframes} keyframes` : "finding you…"}{left < 15 ? ` · ${Math.ceil(left)} s left` : ""}</span>
      </span>
      {!match && <span className="live-hint">{ready ? "The stage follows you; the cast dances along. Finish to keep the take as a dance." : "Step back until your whole body is in frame."}</span>}
      <button className="btn timeline-toggle" onClick={onDiscard} disabled={finishing}><Trash2 size={16} /><span>Discard</span></button>
      <button className="btn primary" onClick={onFinish} disabled={!ready || elapsed < 1 || finishing} title={ready ? "End the take and open it as a dance" : "Wait until you are tracked"}>
        <Check size={17} />{finishing ? "Finishing…" : "Finish take"}
      </button>
    </div>
  );
}
