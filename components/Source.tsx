"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
}

/** Get a clip in: drop/choose a file, or record one from the webcam. */
export default function Source({ onFile, busy }: Props) {
  const [mode, setMode] = useState<"upload" | "record">("upload");
  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex self-start rounded border border-line overflow-hidden text-xs">
        <button className={`px-3 py-1 ${mode === "upload" ? "bg-accent text-black" : "hover:bg-panel-2"}`} onClick={() => setMode("upload")}>upload</button>
        <button className={`px-3 py-1 ${mode === "record" ? "bg-accent text-black" : "hover:bg-panel-2"}`} onClick={() => setMode("record")}>record</button>
      </div>
      {mode === "upload" ? <Upload onFile={onFile} busy={busy} /> : <Record onFile={onFile} busy={busy} />}
    </div>
  );
}

function Upload({ onFile, busy }: Props) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      className={`block cursor-pointer rounded-lg border-2 border-dashed p-8 text-center text-sm transition ${over ? "border-accent bg-panel-2" : "border-line hover:border-muted"}`}
    >
      <div className="text-fg">Drop a short video here, or click to choose</div>
      <div className="text-muted text-xs mt-1">5–30 s works best · one dancer, full body in frame, camera still</div>
      <input type="file" accept="video/*" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </label>
  );
}

function Record({ onFile, busy }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "camera unavailable");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t0 = performance.now();
    const id = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [recording]);

  const start = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const type = rec.mimeType || "video/webm";
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunksRef.current, { type });
      onFile(new File([blob], `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`, { type }));
    };
    rec.start(250);
    recRef.current = rec;
    setElapsed(0);
    setRecording(true);
  };
  const stop = () => {
    recRef.current?.stop();
    setRecording(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
        {/* Mirrored preview so it feels like a mirror; the recording itself is not mirrored. */}
        <video ref={videoRef} className="w-full h-full object-cover -scale-x-100" muted playsInline />
        {recording && (
          <div className="absolute top-2 left-2 flex items-center gap-1.5 text-xs bg-black/60 rounded px-2 py-1">
            <span className="w-2 h-2 rounded-full bg-right animate-pulse" /> REC {elapsed.toFixed(1)}s
          </div>
        )}
        {error && <div className="absolute inset-0 grid place-items-center text-sm text-right">{error}</div>}
      </div>
      <div className="flex items-center gap-2 text-xs">
        {!recording ? (
          <button className="btn" disabled={!ready || busy} onClick={start}>● record</button>
        ) : (
          <button className="btn" onClick={stop}>■ stop &amp; analyse</button>
        )}
        <span className="text-muted">Step back so your whole body is in frame. Stop when done; the clip is analysed right away.</span>
      </div>
    </div>
  );
}
