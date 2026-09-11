"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

/** Native modal semantics provide focus trapping, Escape, and an inert background. */
export default function Dialog({ open, title, description, onClose, children, locked = false, wide = false }: {
  open: boolean; title: string; description?: string; onClose: () => void;
  children: React.ReactNode; locked?: boolean; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId(), descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return <dialog ref={ref} className={`studio-dialog ${wide ? "dialog-wide" : ""}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={(e) => { e.preventDefault(); if (!locked) onClose(); }}
    onClick={(e) => { if (e.target === e.currentTarget && !locked) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    {open && <><div className="dialog-heading"><div><span className="eyebrow">VISUAL ELBOW STUDIO</span><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>{!locked && <button className="icon-button" onClick={onClose} aria-label={`Close ${title}`}><X size={20} /></button>}</div><div className="dialog-content">{children}</div></>}
  </dialog>;
}
