"use client";

import { Check, Trash2 } from "lucide-react";
import { LIVE_MAX_SECONDS } from "@/lib/capture";

interface Props {
  /** Seconds since the take began. */
  elapsed: number;
  keyframes: number;
  /** The body has been measured and the stage is drawing. */
  ready: boolean;
  finishing: boolean;
  onFinish: () => void;
  onDiscard: () => void;
}

/** The transport while a take is live: no playhead, just the clock and how to end it. */
export default function LiveBar({ elapsed, keyframes, ready, finishing, onFinish, onDiscard }: Props) {
  const left = Math.max(0, LIVE_MAX_SECONDS - elapsed);
  return (
    <div className="transport live-bar flex items-center gap-2 text-xs select-none" role="status" aria-live="off">
      <span className="live-pill mono"><span className="live-dot" aria-hidden="true" />LIVE</span>
      <span className="transport-time mono text-muted-foreground">
        <span className="text-foreground">{elapsed.toFixed(1)}</span> s <span className="transport-detail">· {ready ? `${keyframes} keyframes` : "finding you…"}{left < 15 ? ` · ${Math.ceil(left)} s left` : ""}</span>
      </span>
      <span className="live-hint">{ready ? "The stage follows you; the cast dances along. Finish to keep the take as a score." : "Step back until your whole body is in frame."}</span>
      <button className="btn timeline-toggle" onClick={onDiscard} disabled={finishing}><Trash2 size={16} /><span>Discard</span></button>
      <button className="btn primary" onClick={onFinish} disabled={!ready || elapsed < 1 || finishing} title={ready ? "End the take and open it as a score" : "Wait until you are tracked"}>
        <Check size={17} />{finishing ? "Finishing…" : "Finish take"}
      </button>
    </div>
  );
}
