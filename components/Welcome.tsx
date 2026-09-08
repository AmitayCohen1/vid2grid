"use client";

import { useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { ArrowUpRight } from "lucide-react";
import type { DemoPhrase } from "@/lib/demo";
import { AVATAR_PRESETS } from "@/lib/avatars";

const HeroDuet = dynamic(() => import("./HeroDuet"), { ssr: false, loading: () => <div className="duet" /> });

const STEPS = [
  { n: "01", title: "Film", text: "One dancer, a still camera, a short clip. Or go live." },
  { n: "02", title: "Read", text: "Every limb becomes a direction on a grid. Laban and Eshkol–Wachman, re-snapped as you tune it." },
  { n: "03", title: "Compose", text: "Put a character on it, build a cast, export the score. Nothing leaves your device." },
];

const DEFAULT = AVATAR_PRESETS.find((a) => a.label === "Shibu") ?? AVATAR_PRESETS[0];

export default function Welcome({ onStart, onDemo }: { onStart: () => void; onDemo: (phrase: DemoPhrase, avatarPresetUrl?: string) => void }) {
  const [avatar, setAvatar] = useState(DEFAULT);
  const picker = (scroll: boolean) => AVATAR_PRESETS.map((a) => (
    <button key={a.url} className="strip-card" aria-pressed={a.url === avatar.url} title={a.label} onClick={() => { setAvatar(a); if (scroll) window.scrollTo({ top: 0, behavior: "smooth" }); }}>
      <Image src={a.portrait} alt={a.label} width={240} height={320} />
      <span>{a.label}</span>
    </button>
  ));
  return (
    <main className="landing">
      <section className="hero">
        <div className="hero-text">
          <h1>Movement has<br />a language.</h1>
          <div className="hero-side">
            <p>A video of one dancer becomes a playable 3D score. Tracked in your browser. Nothing uploaded.</p>
            <div className="hero-actions">
              <button className="cta" onClick={onStart}>Create a score</button>
              <button className="cta ghost" onClick={() => onDemo("reach", avatar.url)}>Try an example <ArrowUpRight size={15} /></button>
            </div>
          </div>
        </div>
        <HeroDuet avatarUrl={avatar.url}>{picker(false)}</HeroDuet>
        <div className="hero-caption mono"><span>Video → score → {avatar.label}</span><span>Pick a character · or bring your own VRM</span></div>
      </section>

      {/* On phones the picker can't sit beside the picture; it becomes a strip under it. */}
      <section className="cast-strip" aria-label="The cast">
        <div className="strip-head"><span>The cast</span><span>Pick one to see them dance. Or bring your own VRM.</span></div>
        <div className="strip-row">{picker(true)}</div>
      </section>

      <section className="steps" aria-label="How it works">
        {STEPS.map((s) => <div key={s.n}><span className="mono">{s.n}</span><h3>{s.title}</h3><p>{s.text}</p></div>)}
      </section>

      <footer className="landing-footer"><span>vid2grid — Movement Languages</span><span>Runs entirely in your browser.</span></footer>
    </main>
  );
}
