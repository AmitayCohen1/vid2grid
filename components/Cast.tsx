"use client";

import Image from "next/image";
import { Activity, ChevronDown, Copy, FlipHorizontal2, Rewind, Shirt, User, UserPlus, X } from "lucide-react";
import { AVATAR_PRESETS } from "@/lib/avatars";
import type { Score } from "@/lib/score";
import { type Devices, MAX_SIZE, MIN_SIZE } from "@/lib/devices";
import { lookLabel } from "./CharacterGrid";
import { Note, NumSlider, Section } from "./Inspector";

/** A dancer placed on the shared stage: a snapshot of a dance (its own
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

export type CastPatch = Partial<Pick<CastMember, "x" | "z" | "rot" | "delay" | "rate" | "mirror" | "reverse" | "size" | "avatarUrl" | "name">>;

/** The dancer being edited: the dance the studio is about, always first on the stage. */
export interface Lead {
  name: string;
  dance: string;
  avatarUrl: string | null;
}

interface Props {
  lead: Lead | null;
  cast: CastMember[];
  /** Seconds per beat of the current clip, for reading entrances musically. */
  beat: number;
  onAdd: () => void;
  /** Go to the lead's own settings (the Dancer tab). */
  onEditLead: () => void;
  /** Change a member's look. */
  onLook: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: CastPatch) => void;
}

const beats = (seconds: number, beat: number) => {
  const n = Math.round(seconds / beat * 4) / 4;
  return `${n} beat${Math.abs(n - 1) < 1e-9 ? "" : "s"}`;
};

/** One line that says what a member is doing, read without opening the card. */
function describe(m: CastMember, beat: number): string {
  const bits = [m.score.source.name.replace(/\.[^.]+$/, "")];
  bits.push(m.delay > 0 ? `enters ${beats(m.delay, beat)} later` : "in unison");
  if (Math.abs(m.rate - 1) > 1e-9) bits.push(`${m.rate}× speed`);
  if (m.mirror) bits.push("mirrored");
  if (m.reverse) bits.push("backwards");
  return bits.join(" · ");
}

/** The roster: everyone on the stage, the lead first, then each added
 *  dancer as a card that opens to its placement and devices. */
export default function CastPanel({ lead, cast, beat, onAdd, onEditLead, onLook, onDuplicate, onRemove, onUpdate }: Props) {
  return (
    <>
      <Section title="On the stage" aside={<span className="insp-aside">{cast.length + (lead ? 1 : 0)} dancer{cast.length + (lead ? 1 : 0) === 1 ? "" : "s"}</span>}>
        <ul className="cast-list">
          {lead && (
            <li className="cast-card is-lead">
              <div className="cast-head">
                <Thumb url={lead.avatarUrl} />
                <span className="cast-title"><strong>{lead.name}</strong><small>Lead · {lead.dance}</small></span>
                <button className="insp-btn" onClick={onEditLead} title="The lead's look, size and overlays live in the Dancer tab"><Shirt size={12} /> Look</button>
              </div>
            </li>
          )}
          {cast.map((m, i) => (
            <li key={m.id} className="cast-card">
              <details>
                <summary className="cast-head">
                  <Thumb url={m.avatarUrl} />
                  <span className="cast-title"><strong><span className="mono">{i + 2}</span>{m.name}</strong><small>{describe(m, beat)}</small></span>
                  <ChevronDown size={14} className="cast-chevron" />
                </summary>
                <div className="cast-body">
                  <div className="cast-actions">
                    <button className="insp-btn" onClick={() => onLook(m.id)} title="Choose another character"><Shirt size={12} /> Look</button>
                    <button className="insp-btn" aria-pressed={m.mirror} onClick={() => onUpdate(m.id, { mirror: !m.mirror })} title="The audience's mirror image: left and right swapped"><FlipHorizontal2 size={12} /> Mirror</button>
                    <button className="insp-btn" aria-pressed={m.reverse} onClick={() => onUpdate(m.id, { reverse: !m.reverse })} title="The clip runs backwards"><Rewind size={12} /> Reverse</button>
                    <span className="cast-spacer" />
                    <button className="insp-icon" aria-label={`Duplicate ${m.name}`} title="Duplicate" onClick={() => onDuplicate(m.id)}><Copy size={13} /></button>
                    <button className="insp-icon" aria-label={`Remove ${m.name}`} title="Remove from the stage" onClick={() => onRemove(m.id)}><X size={13} /></button>
                  </div>
                  <span className="cast-group">Timing</span>
                  <NumSlider label="Entrance" hint={`Waits in the first pose, then starts — ${beats(m.delay, beat)} at the current tempo`} min={0} max={8} step={0.05} decimals={2} unit="s" value={m.delay} onChange={(delay) => onUpdate(m.id, { delay })} />
                  <NumSlider label="Speed" hint="How fast the clip runs: 2 is twice as fast, 0.5 half speed" min={0.25} max={2} step={0.05} decimals={2} unit="×" value={m.rate} onChange={(rate) => onUpdate(m.id, { rate })} />
                  <span className="cast-group">Placement</span>
                  <NumSlider label="Across" hint="Left / right on the stage, and beside you in the video" min={-4} max={4} step={0.1} decimals={1} unit="m" value={m.x} onChange={(x) => onUpdate(m.id, { x })} />
                  <NumSlider label="Depth" hint="Front / back on the stage" min={-4} max={4} step={0.1} decimals={1} unit="m" value={m.z} onChange={(z) => onUpdate(m.id, { z })} />
                  <NumSlider label="Turn" hint="Facing, in degrees" min={-180} max={180} step={5} unit="°" value={m.rot} onChange={(rot) => onUpdate(m.id, { rot })} />
                  <NumSlider label="Size" hint="How big this dancer is drawn: 1 is their tracked size, 2 twice as tall" min={MIN_SIZE} max={MAX_SIZE} step={0.05} decimals={2} unit="×" value={m.size} onChange={(size) => onUpdate(m.id, { size })} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        <button className="cast-add" onClick={onAdd}>
          <UserPlus size={18} />
          <span><strong>Add a dancer</strong><small>{cast.length === 0 ? "A character doing this dance, a canon, another video, or an example." : "Another character, another dance, or a canon."}</small></span>
        </button>
        {cast.length === 0 && <Note>Everyone here shares the stage and the clock. In the Side by side and Video views they dance inside your video, beside you.</Note>}
      </Section>
    </>
  );
}

/** A small still of the dancer's look: a bundled portrait, a generic
 *  figure for a custom VRM, or the skeleton mark. */
export function Thumb({ url }: { url: string | null }) {
  const preset = url ? AVATAR_PRESETS.find((a) => a.url === url) : null;
  return (
    <span className="insp-thumb" title={lookLabel(url)}>
      {preset ? <Image src={preset.portrait} alt="" width={60} height={80} sizes="30px" /> : url ? <User size={14} /> : <Activity size={14} />}
    </span>
  );
}
