"use client";
import { useState } from "react";
import { Download, FileJson } from "lucide-react";
import type { Score } from "@/lib/score";

export default function SaveScore({ score, onSave }: { score: Score; onSave: (name: string) => void }) {
  const [name, setName] = useState(score.source.name.replace(/\.[^.]+$/, ""));
  return <form className="save-score-form" onSubmit={(e) => { e.preventDefault(); onSave(name.trim()); }}>
    <div className="save-summary"><FileJson size={32} /><div><strong>A score you can come back to</strong><p>{score.source.duration.toFixed(1)} seconds · {score.frames.length} frames · {score.grid.azStep}° grid</p></div></div>
    <label className="form-field"><span>File name</span><input autoComplete="off" maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} /><small>.vid2grid.json</small></label>
    <p className="dialog-note">Includes this dancer’s movement and grid settings. The original video, avatar, and other cast members are not included. Use <strong>New score → Open score</strong> to reopen it.</p>
    <button className="btn primary dialog-primary" type="submit" disabled={!name.trim()}><Download size={18} /> Download score</button>
  </form>;
}
