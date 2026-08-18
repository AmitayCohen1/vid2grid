"use client";

import type { Pose } from "@/lib/pose";
import { BONES, type BoneId } from "@/lib/skeleton";
import { LABAN_ARROW, eshkolWachman, laban } from "@/lib/grid";

interface Props {
  snapped: Pose;
  raw: Pose;
  selected: BoneId | null;
  onSelect: (id: BoneId | null) => void;
}

/** Where every segment is, right now: on the grid, in Laban, in Eshkol-Wachman, and raw. */
export default function BoneTable({ snapped, raw, selected, onSelect }: Props) {
  return (
    <div className="text-xs">
      <div className="grid grid-cols-[1.4fr_1fr_1.3fr_1fr_1fr] gap-x-2 px-2 py-1 text-muted border-b border-line">
        <span>segment</span><span>grid az/el</span><span>Laban</span><span>E-W</span><span className="text-right">raw</span>
      </div>
      {BONES.map((b) => {
        const s = snapped.bones[b.id];
        const r = raw.bones[b.id];
        const lb = laban(s);
        const ew = eshkolWachman(s);
        const sel = selected === b.id;
        return (
          <button
            key={b.id}
            onClick={() => onSelect(sel ? null : b.id)}
            className={`w-full grid grid-cols-[1.4fr_1fr_1.3fr_1fr_1fr] gap-x-2 px-2 py-[3px] text-left border-b border-line/50 hover:bg-panel-2 ${sel ? "bg-panel-2 text-accent" : ""} ${b.core ? "" : "text-muted"}`}
          >
            <span className="truncate">
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${b.side === "L" ? "bg-left" : b.side === "R" ? "bg-right" : "bg-centre"}`} />
              {b.label}
            </span>
            <span className="mono">{fmt(s[0])}° {fmtS(s[1])}°</span>
            <span className="mono">{LABAN_ARROW[lb.dir]} {lb.dir === "place" ? (s[1] > 0 ? "up" : "down") : `${lb.dir.replace("-", "‑")} ${lb.level}`}</span>
            <span className="mono">{ew.text}</span>
            <span className="mono text-right text-muted">{fmt(r[0])}° {fmtS(r[1])}°</span>
          </button>
        );
      })}
      <div className="grid grid-cols-3 gap-2 px-2 py-2 text-muted mono">
        <span>facing {fmt(snapped.facing)}° <span className="opacity-60">({fmt(raw.facing)}°)</span></span>
        <span>hips {snapped.hipY.toFixed(2)} m</span>
        <span>conf {(raw.conf * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

const fmt = (n: number) => String(Math.round(n)).padStart(3, " ");
const fmtS = (n: number) => (n >= 0 ? "+" : "−") + String(Math.abs(Math.round(n))).padStart(2, "0");
