"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Activity, Upload, User } from "lucide-react";
import { AVATAR_PRESETS, turnSheet } from "@/lib/avatars";
import { preloadAvatar } from "./Avatar";

export interface LookProps {
  /** false = the stick figure. */
  avatar: boolean;
  avatarUrl: string;
  /** The name of a custom VRM, or null when a bundled character (or the skeleton) is chosen. */
  avatarName: string | null;
  onAvatar: (b: boolean) => void;
  onAvatarPreset: (url: string) => void;
  onAvatarFile: (f: File) => void;
}

/** Skeleton, the bundled characters as portraits, a custom VRM, and an upload
 *  tile. Like a game's character select: a portrait turns around under the
 *  pointer, and does one full turn when picked. */
export default function CharacterGrid(p: LookProps) {
  const custom = p.avatarName !== null;
  const [spin, setSpin] = useState<string | null>(null);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pick = (url: string) => {
    p.onAvatarPreset(url);
    setSpin(url);
    if (spinTimer.current) clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setSpin(null), 1150); // one turn (1.1 s in the CSS)
  };
  useEffect(() => () => { if (spinTimer.current) clearTimeout(spinTimer.current); }, []);
  // Warm the turnaround sheets so the first hover doesn't stutter.
  useEffect(() => { for (const a of AVATAR_PRESETS) { const img = new window.Image(); img.src = turnSheet(a.portrait); } }, []);
  return (
    <div className="insp-tiles" role="radiogroup" aria-label="Dancer look">
      <button type="button" role="radio" aria-checked={!p.avatar} title="Stick figure: every joint and limb, clearly." onClick={() => p.onAvatar(false)}>
        <span className="insp-tile-art"><Activity size={22} /></span><span>Skeleton</span>
      </button>
      {AVATAR_PRESETS.map((a) => (
        <button type="button" key={a.url} role="radio" aria-checked={p.avatar && !custom && p.avatarUrl === a.url} title={a.label}
          className={spin === a.url ? "is-picked" : undefined}
          onPointerEnter={() => preloadAvatar(a.url)} onFocus={() => preloadAvatar(a.url)}
          onClick={() => pick(a.url)}>
          <span className="insp-tile-art">
            <Image src={a.portrait} alt="" width={120} height={160} sizes="80px" />
            <span className="insp-turn" style={{ backgroundImage: `url(${turnSheet(a.portrait)})` }} />
          </span>
          <span>{a.label}</span>
        </button>
      ))}
      {custom && (
        <button type="button" role="radio" aria-checked={p.avatar} title={p.avatarName ?? "Your avatar"} onClick={() => p.onAvatar(true)}>
          <span className="insp-tile-art"><User size={22} /></span><span>{p.avatarName}</span>
        </button>
      )}
      <label className="insp-tile-upload" title="Open a VRoid .vrm of your own">
        <span className="insp-tile-art"><Upload size={18} /></span><span>Open .vrm</span>
        <input aria-label="Choose a VRM avatar" type="file" accept=".vrm" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onAvatarFile(f); e.currentTarget.value = ""; }} />
      </label>
    </div>
  );
}

/** What a look is called: the character's name, a custom file's, or the skeleton. */
export function lookLabel(avatarUrl: string | null, avatarName?: string | null): string {
  if (!avatarUrl) return "Skeleton";
  return AVATAR_PRESETS.find((a) => a.url === avatarUrl)?.label ?? avatarName ?? "Custom character";
}
