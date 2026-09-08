"use client";

import Image from "next/image";
import { useState } from "react";
import { Activity, Copy, FlipHorizontal2, Plus, Rewind, User, X } from "lucide-react";
import { AVATAR_PRESETS } from "@/lib/avatars";
import type { Score } from "@/lib/score";
import type { Devices } from "@/lib/devices";
import { Note, NumSlider, Row, Section } from "./Inspector";

/** A dancer placed on the shared stage: a snapshot of a score (its own
 *  clip, its own timing) plus a look, a floor placement, and the
 *  choreographic devices applied to the clip (lib/devices.ts). */
export interface CastMember extends Devices {
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

export type CastPatch = Partial<Pick<CastMember, "x" | "z" | "rot" | "delay" | "rate" | "mirror" | "reverse">>;

interface Props {
  cast: CastMember[];
  canAdd: boolean;
  /** Seconds per beat of the current clip, for reading delays musically. */
  beat: number;
  onAdd: () => void;
  /** Add `voices − 1` copies of the current dancer, each `gap` seconds later than the last. */
  onCanon: (voices: number, gap: number) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: CastPatch) => void;
}

const beats = (seconds: number, beat: number) => {
  const n = seconds / beat;
  return `${Math.round(n * 4) / 4} beat${Math.abs(n - 1) < 1e-9 ? "" : "s"}`;
};

/** The choreography cast: every added dancer keeps dancing their own
 *  clip while sharing the stage with the live one. */
export default function CastPanel({ cast, canAdd, beat, onAdd, onCanon, onDuplicate, onRemove, onUpdate }: Props) {
  const [voices, setVoices] = useState(3);
  const [gapBeats, setGapBeats] = useState(1);
  return (
    <>
      <Section title="Cast" aside={
        <button className="insp-btn" disabled={!canAdd} onClick={onAdd} title="Pin the current dancer (clip + look) onto the stage"><Plus size={12} /> Add dancer</button>
      }>
        {cast.length === 0 ? (
          <Note>Add the current dancer, then load another clip and add that one too. Each keeps their own clip&apos;s movement on one stage. In Compare view the cast dances inside the video, beside you.</Note>
        ) : (
          <ul className="insp-cast">
            {cast.map((m, i) => (
              <li key={m.id} className="insp-cast-member">
                <div className="insp-cast-head">
                  <Thumb url={m.avatarUrl} />
                  <span className="insp-cast-name"><span className="mono">{i + 1}</span>{m.name}</span>
                  <span className="insp-cast-actions">
                    <button className="insp-icon" aria-label={`Duplicate ${m.name}`} title="Duplicate" onClick={() => onDuplicate(m.id)}><Copy size={13} /></button>
                    <button className="insp-icon" aria-label={`Remove ${m.name}`} title="Remove" onClick={() => onRemove(m.id)}><X size={13} /></button>
                  </span>
                </div>
                <NumSlider label="X" hint="Left / right on the stage, and beside you in the video" min={-4} max={4} step={0.1} decimals={1} unit="m" value={m.x} onChange={(x) => onUpdate(m.id, { x })} />
                <NumSlider label="Z" hint="Front / back on the stage" min={-4} max={4} step={0.1} decimals={1} unit="m" value={m.z} onChange={(z) => onUpdate(m.id, { z })} />
                <NumSlider label="Turn" hint="Facing, in degrees" min={-180} max={180} step={5} unit="°" value={m.rot} onChange={(rot) => onUpdate(m.id, { rot })} />
                <NumSlider label="Delay" hint={`Waits in the first pose, then starts — ${beats(m.delay, beat)} at the current tempo`} min={0} max={8} step={0.05} decimals={2} unit="s" value={m.delay} onChange={(delay) => onUpdate(m.id, { delay })} />
                <NumSlider label="Speed" hint="How fast the clip runs: 2 is twice as fast, 0.5 half speed" min={0.25} max={2} step={0.05} decimals={2} unit="×" value={m.rate} onChange={(rate) => onUpdate(m.id, { rate })} />
                <Row label="Devices" hint="Mirror swaps left and right. Reverse runs the clip backwards.">
                  <span className="insp-toggles">
                    <button className="insp-btn" aria-pressed={m.mirror} onClick={() => onUpdate(m.id, { mirror: !m.mirror })}><FlipHorizontal2 size={12} /> Mirror</button>
                    <button className="insp-btn" aria-pressed={m.reverse} onClick={() => onUpdate(m.id, { reverse: !m.reverse })}><Rewind size={12} /> Reverse</button>
                  </span>
                </Row>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Canon" aside={
        <button className="insp-btn" disabled={!canAdd} onClick={() => onCanon(voices, gapBeats * beat)} title="Add copies of the current dancer, each starting a little later"><Plus size={12} /> Add canon</button>
      }>
        <NumSlider label="Voices" hint="How many dancers in all, counting you" min={2} max={5} step={1} value={voices} onChange={setVoices} />
        <NumSlider label="Gap" hint={`Each voice starts this much after the last — ${(gapBeats * beat).toFixed(2)} s at the current tempo`} min={0.25} max={8} step={0.25} decimals={2} unit="beats" value={gapBeats} onChange={setGapBeats} />
        <Note>The same phrase, entering one after another. Change a voice&apos;s Delay, Mirror, or Reverse afterwards to make it yours.</Note>
      </Section>
    </>
  );
}

/** A small still of the dancer's look: a bundled portrait, a generic
 *  figure for a custom VRM, or the skeleton mark. */
export function Thumb({ url }: { url: string | null }) {
  const preset = url ? AVATAR_PRESETS.find((a) => a.url === url) : null;
  return (
    <span className="insp-thumb" title={preset?.label ?? (url ? "Custom character" : "Skeleton")}>
      {preset ? <Image src={preset.portrait} alt="" width={60} height={80} sizes="30px" /> : url ? <User size={14} /> : <Activity size={14} />}
    </span>
  );
}
