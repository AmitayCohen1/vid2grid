"use client";

import { ChevronDown } from "lucide-react";

/** The inspector kit: the controls of the settings panel. Each one names
 *  itself and, where it has a hint, says what it does in a line underneath —
 *  nothing a newcomer needs is left to a tooltip. */

function Text({ label, hint }: { label: string; hint?: string }) {
  return <span className="insp-text"><span className="insp-label">{label}</span>{hint && <span className="insp-hint">{hint}</span>}</span>;
}

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
      <summary className="insp-section-head"><span>{title}</span>{aside}<ChevronDown size={17} /></summary>
      {children}
    </details>
  );
}

export function Row({ label, hint, disabled = false, children }: { label: string; hint?: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className={`insp-row ${disabled ? "is-disabled" : ""}`}>
      <Text label={label} hint={hint} />
      {children}
    </div>
  );
}

export function Switch({ label, hint, checked, onChange, disabled = false }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`insp-row insp-switch ${disabled ? "is-disabled" : ""}`}>
      <Text label={label} hint={hint} />
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Pick one. `titled` writes the label above it (leave it off under a section
 *  heading that already says the same); the chosen option's hint reads below. */
export function Seg<T extends string | number>({ label, value, options, onChange, titled = false }: { label: string; value: T; options: { value: T; label: React.ReactNode; hint?: string }[]; onChange: (v: T) => void; titled?: boolean }) {
  const hint = options.find((o) => o.value === value)?.hint;
  const seg = (
    <div className="insp-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={value === o.value} title={o.hint} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
  if (!titled && !hint) return seg;
  return <div className="insp-field">{titled && <span className="insp-label">{label}</span>}{seg}{hint && <span className="insp-hint">{hint}</span>}</div>;
}

/** Several small toggles in a row: pick any number of them. */
export function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T[]; options: { value: T; label: string; hint?: string }[]; onChange: (v: T[]) => void }) {
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="insp-field">
      <span className="insp-label">{label}</span>
      <div className="insp-chips" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} aria-pressed={value.includes(o.value)} title={o.hint} onClick={() => toggle(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

/** A colour swatch that opens the native picker. */
export function Colour({ label, hint, value, disabled = false, onChange }: { label: string; hint?: string; value: string; disabled?: boolean; onChange: (v: string) => void }) {
  return (
    <label className={`insp-row ${disabled ? "is-disabled" : ""}`}>
      <Text label={label} hint={hint} />
      <input type="color" className="insp-color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** A slider: its name and editable value on one line, the track under them. */
export function NumSlider({ label, hint, value, min, max, step, unit = "", decimals = 0, disabled = false, onChange }:
  { label: string; hint?: string; value: number; min: number; max: number; step: number; unit?: string; decimals?: number; disabled?: boolean; onChange: (n: number) => void }) {
  const commit = (n: number) => { if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n))); };
  return (
    <div className={`insp-row insp-slider ${disabled ? "is-disabled" : ""}`} title={hint}>
      <span className="insp-label">{label}</span>
      <span className="insp-num">
        <input type="number" aria-label={`${label} value`} min={min} max={max} step={step} value={value.toFixed(decimals)} disabled={disabled}
          onChange={(e) => commit(+e.target.value)} />
        {unit && <span>{unit}</span>}
      </span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} />
      {hint && <span className="insp-hint">{hint}</span>}
    </div>
  );
}

export function Select({ label, hint, value, options, disabled = false, onChange }:
  { label: string; hint?: string; value: string; options: { value: string; label: string }[]; disabled?: boolean; onChange: (v: string) => void }) {
  return (
    <label className={`insp-row ${disabled ? "is-disabled" : ""}`}>
      <Text label={label} hint={hint} />
      <select className="insp-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="insp-note">{children}</p>;
}
