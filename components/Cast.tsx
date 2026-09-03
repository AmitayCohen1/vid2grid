"use client";

import { Copy, Plus, X } from "lucide-react";
import type { Score } from "@/lib/score";

/** A dancer placed on the shared stage: a snapshot of a score (its own
 *  clip, its own timing) plus a look and a floor placement. */
export interface CastMember {
  id: string;
  name: string;
  score: Score;
  /** null = stick figure */
  avatarUrl: string | null;
  /** stage offset in metres and a floor rotation in degrees */
  x: number;
  z: number;
  rot: number;
}

interface Props {
  cast: CastMember[];
  canAdd: boolean;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<CastMember, "x" | "z" | "rot">>) => void;
}

/** The choreography cast: every added dancer keeps dancing their own
 *  clip while sharing the stage with the live one. */
export default function CastPanel({ cast, canAdd, onAdd, onDuplicate, onRemove, onUpdate }: Props) {
  return (
    <section className="flex flex-col gap-2.5 p-4 pt-0 text-[13px]">
      <div className="label">cast</div>
      <button className="btn self-start" disabled={!canAdd} onClick={onAdd} title="pin the current dancer (clip + look) onto the stage">
        <Plus size={14} /> add dancer to stage
      </button>
      {cast.length === 0 ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Build a group piece: track a clip, place the dancer, then load another clip and add
          that one too — every dancer keeps their own clip&apos;s movement, together in one space.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {cast.map((m, i) => (
            <div key={m.id} className="card p-2.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium">{i + 1} · {m.name}</span>
                <span className="text-muted-foreground text-[11px]">{m.avatarUrl ? "character" : "sticks"}</span>
                <span className="ml-auto flex items-center gap-1">
                  <button className="text-muted-foreground hover:text-foreground" title="duplicate" onClick={() => onDuplicate(m.id)}><Copy size={13} /></button>
                  <button className="text-muted-foreground hover:text-destructive" title="remove" onClick={() => onRemove(m.id)}><X size={14} /></button>
                </span>
              </div>
              <Slider label={`x ${m.x.toFixed(1)} m`} min={-4} max={4} step={0.1} value={m.x} onChange={(x) => onUpdate(m.id, { x })} />
              <Slider label={`z ${m.z.toFixed(1)} m`} min={-4} max={4} step={0.1} value={m.z} onChange={(z) => onUpdate(m.id, { z })} />
              <Slider label={`turn ${Math.round(m.rot)}°`} min={-180} max={180} step={5} value={m.rot} onChange={(rot) => onUpdate(m.id, { rot })} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="grid grid-cols-[5rem_1fr] items-center gap-2">
      <span className="text-muted-foreground mono text-xs">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}
