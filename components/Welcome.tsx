"use client";

import Image from "next/image";
import { ArrowUpRight, ArrowRight, Copy, Download, Film, Grid2X2, Play, ScanLine, ShieldCheck, Sparkles, UploadCloud, Users } from "lucide-react";
import { createDemo, DEMO_PHRASES, type DemoPhrase } from "@/lib/demo";
import { AVATAR_PRESETS } from "@/lib/avatars";
import { forwardKinematics } from "@/lib/fk";
import { BONES } from "@/lib/skeleton";

const study = createDemo();
const poses = [35, 60, 85, 110, 135].map((i) => forwardKinematics(study.raw[i], study.body));

/** Each cast card opens a different study so the roster invites browsing. */
const CAST_PHRASES: DemoPhrase[] = ["reach", "turn", "sway", "reach", "turn"];

const FEATURES = [
  { icon: UploadCloud, title: "Start from any clip", text: "Upload a video, record one on the spot, or go live and watch the score form as you move. The tracker reads the dancer frame by frame, entirely in your browser." },
  { icon: Users, title: "Compose your own choreography", text: "Add dancers to the cast, duplicate the one you have, and place each on the stage — a group piece grown from a single phrase." },
  { icon: Play, title: "Play with the movement", text: "Loop it, slow it to quarter speed, step frame by frame, scrub the playhead. The score is yours to explore from every angle." },
  { icon: Grid2X2, title: "Read it as notation", text: "Every limb becomes a direction on a grid — Laban and Eshkol–Wachman readings that re-snap instantly when you change the settings." },
  { icon: Film, title: "See it three ways", text: "A 3D stage you can orbit, a side-by-side compare with your video, and generative traces after Synchronous Objects." },
  { icon: Download, title: "Keep it, share it, reopen it", text: "Export any score as a small JSON file, import it later, and pick up where you left off. Nothing ever leaves your device." },
];

export default function Welcome({ onStart, onDemo }: { onStart: () => void; onDemo: (phrase: DemoPhrase, avatarPresetUrl?: string) => void }) {
  return (
    <main className="welcome">
      <section className="welcome-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-dot" /> A studio for movement exploration</div>
          <h1>Movement has<br />a <em>language.</em></h1>
          <p className="hero-description">Find it in every frame. Turn a dance video into a living 3D score. Explore the gesture, trace its patterns, and see the phrase in a new way.</p>
          <div className="hero-actions">
            <button onClick={onStart} className="btn primary hero-cta">Create a score <ArrowRight size={17} /></button>
            <button className="text-action" onClick={() => onDemo("reach")}><Play size={14} fill="currentColor" /> Explore an example</button>
          </div>
          <p className="privacy-note"><ShieldCheck size={14} /> On your device. In your browser. Yours.</p>
        </div>
        <button className="movement-art" onClick={() => onDemo("reach")} aria-label="Play the Reach and release example">
          <div className="art-top"><span className="mono">MOVEMENT STUDY / 001</span><ArrowUpRight size={19} /></div>
          <svg viewBox="0 0 600 420" fill="none" aria-hidden="true">
            <defs>
              <radialGradient id="studio-glow"><stop stopColor="#e3e6ee" stopOpacity=".1" /><stop offset="1" stopColor="#e3e6ee" stopOpacity="0" /></radialGradient>
              <linearGradient id="trail-color"><stop stopColor="#707683" stopOpacity="0" /><stop offset=".5" stopColor="#eef1f7" /><stop offset="1" stopColor="#e3e6ee" stopOpacity=".1" /></linearGradient>
            </defs>
            <ellipse cx="300" cy="235" rx="290" ry="190" fill="url(#studio-glow)" />
            {Array.from({ length: 11 }, (_, i) => <path key={`h${i}`} d={`M 20 ${285 + i * 11} L 580 ${285 + i * 11}`} stroke="#b6bbc6" strokeOpacity=".09" />)}
            {Array.from({ length: 15 }, (_, i) => <path key={`v${i}`} d={`M ${160 + i * 20} 270 L ${-120 + i * 60} 420`} stroke="#b6bbc6" strokeOpacity=".09" />)}
            {[0, 1, 2, 3].map((i) => <ellipse key={i} cx="303" cy="207" rx={130 + i * 12} ry={144 - i * 8} transform={`rotate(${-35 + i * 22} 303 207)`} stroke="url(#trail-color)" strokeWidth=".8" strokeDasharray={i % 2 ? "2 7" : undefined} />)}
            {poses.map((joints, p) => {
              const project = (v: { x: number; y: number; z: number }) => [300 + v.x * 135 + (p - 2) * 35 + v.z * 25, 342 - v.y * 135 + v.z * 8];
              const active = p === 2;
              return <g key={p} opacity={active ? 1 : .12 + p * .045} stroke={active ? "#eef1f7" : "#9aa1ad"} strokeLinecap="round">
                {BONES.map((b) => { const a = project(joints[b.from]), z = project(joints[b.to]); return <line key={b.id} x1={a[0]} y1={a[1]} x2={z[0]} y2={z[1]} strokeWidth={active ? 4 : 1.5} />; })}
                {Object.entries(joints).map(([id, v]) => { const q = project(v); return <circle key={id} cx={q[0]} cy={q[1]} r={id === "headTop" ? 9 : active ? 3.5 : 2} fill={active ? "#eef1f7" : "#9aa1ad"} stroke="none" />; })}
              </g>;
            })}
            <path d="M 370 155 L 438 108 H 525" stroke="#c9cdd7" strokeOpacity=".45" />
            <circle cx="370" cy="155" r="4" stroke="#c9cdd7" />
            <text x="441" y="97" fill="#9aa0ab" fontFamily="monospace" fontSize="10">AZ 90° / EL 22.5°</text>
            <text x="38" y="245" fill="#868c98" fontFamily="monospace" fontSize="10" transform="rotate(-90 38 245)">THE BODY AS A SCORE</text>
          </svg>
          <div className="art-bottom"><span><span className="art-play"><Play size={12} fill="currentColor" /></span> Reach &amp; release</span><span className="mono">8.0 s <span className="art-divider">/</span> 240 frames</span></div>
        </button>
      </section>

      <section id="start" className="start-section">
        <div className="start-upload"><div className="section-heading"><span className="eyebrow">YOUR VIDEO → YOUR SCORE</span><span className="mono subtle">No account needed</span></div><h2>Bring a phrase.</h2><button className="start-card" onClick={onStart}><UploadCloud size={28} /><strong>Start with your video</strong><span>Choose a clip or record one. Preview it, then create your score.</span><span className="start-card-link">Choose how to start <ArrowRight size={18} /></span></button></div>
        <div className="example-section"><div className="section-heading"><span className="eyebrow">JUST EXPLORING?</span><Sparkles size={15} /></div><h2>Try an example.</h2><p className="subtle example-intro">Choose a study and press Play. No video needed.</p>
          <div className="example-list">{DEMO_PHRASES.map((p, i) => <button key={p.id} className="example-row" onClick={() => onDemo(p.id)}><span className="example-number mono">0{i + 1}</span><span className="example-name">{p.name}<small>{p.detail}</small></span><span className="mono subtle">{p.duration}</span><ArrowUpRight size={17} /></button>)}</div>
        </div>
      </section>

      <section className="cast-section" aria-label="Meet the cast">
        <div className="section-heading"><span className="eyebrow">MEET THE CAST</span><span className="mono subtle">VRM · OR BRING YOUR OWN</span></div>
        <h2>Thirteen dancers, ready when you are.</h2>
        <p className="subtle cast-intro">Any score can be performed by a character — pick one to see them move, switch mid-piece, or open a VRoid .vrm of your own in the studio.</p>
        <div className="cast-row">
          {AVATAR_PRESETS.map((a, i) => (
            <button key={a.url} className="cast-card" onClick={() => onDemo(CAST_PHRASES[i % CAST_PHRASES.length], a.url)}>
              <Image src={a.portrait} alt={`${a.label}, one of the bundled characters`} width={480} height={640} />
              <span className="cast-name">{a.label}<small><Play size={9} fill="currentColor" /> See them dance</small></span>
            </button>
          ))}
        </div>
      </section>

      <section className="feature-section" aria-label="What the studio can do">
        <div className="section-heading"><span className="eyebrow">THE STUDIO</span><span className="mono subtle">EVERYTHING RUNS IN YOUR BROWSER</span></div>
        <h2>Make it, then play with it.</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => <div key={f.title} className="feature-card"><f.icon size={20} /><h3>{f.title}</h3><p>{f.text}</p></div>)}
        </div>
      </section>

      <section className="workflow" aria-label="How it works">
        <div><ScanLine size={20} /><h3>Capture the gesture</h3><p>A video, one dancer, a still camera. The tracker follows your movement, frame by frame.</p></div>
        <div><span className="workflow-symbol">↗</span><h3>Read the movement</h3><p>Explore a 3D figure and directional readings inspired by Laban and Eshkol–Wachman.</p></div>
        <div><Copy size={20} /><h3>Compose what comes next</h3><p>Adjust the grid, duplicate dancers into a cast, and export a score to return to whenever inspiration strikes.</p></div>
      </section>
      <footer className="welcome-footer"><span>vid2grid <span className="subtle">/ Movement Languages</span></span><span className="subtle">A different way to see dance.</span></footer>
    </main>
  );
}
