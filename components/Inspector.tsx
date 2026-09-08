"use client";

import { ChevronDown } from "lucide-react";

/** The inspector kit: the small, dense controls of a video editor's
 *  properties panel. Every row is one line — a label on the left, the
 *  control on the right — so the whole panel reads at a glance. */

export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="insp-section">
      <header className="insp-section-head"><span>{title}</span>{aside}</header>
      {children}
    </section>
  );
}

/** A collapsible section; closed by default. */
export function Disclosure({ title, aside, children, open = false }: { title: string; aside?: React.ReactNode; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="insp-section insp-disclosure" open={open}>
      <summary className="insp-section-head"><span>{title}</span>{aside}<ChevronDown size={13} /></summary>
      {children}
    </details>
  );
}

export function Row({ label, hint, disabled = false, children }: { label: string; hint?: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className={`insp-row ${disabled ? "is-disabled" : ""}`} title={hint}>
      <span className="insp-label">{label}</span>
      {children}
    </div>
  );
}

export function Switch({ label, hint, checked, onChange, disabled = false }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`insp-row insp-switch ${disabled ? "is-disabled" : ""}`} title={hint}>
      <span className="insp-label">{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: React.ReactNode; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="insp-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={value === o.value} title={o.hint} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** A slider with its value as an editable number beside it. */
export function NumSlider({ label, hint, value, min, max, step, unit = "", decimals = 0, disabled = false, onChange }:
  { label: string; hint?: string; value: number; min: number; max: number; step: number; unit?: string; decimals?: number; disabled?: boolean; onChange: (n: number) => void }) {
  const commit = (n: number) => { if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n))); };
  return (
    <div className={`insp-row insp-slider ${disabled ? "is-disabled" : ""}`} title={hint}>
      <span className="insp-label">{label}</span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} />
      <span className="insp-num">
        <input type="number" aria-label={`${label} value`} min={min} max={max} step={step} value={value.toFixed(decimals)} disabled={disabled}
          onChange={(e) => commit(+e.target.value)} />
        {unit && <span>{unit}</span>}
      </span>
    </div>
  );
}

export function Select({ label, hint, value, options, disabled = false, onChange }:
  { label: string; hint?: string; value: string; options: { value: string; label: string }[]; disabled?: boolean; onChange: (v: string) => void }) {
  return (
    <label className={`insp-row ${disabled ? "is-disabled" : ""}`} title={hint}>
      <span className="insp-label">{label}</span>
      <select className="insp-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="insp-note">{children}</p>;
}
