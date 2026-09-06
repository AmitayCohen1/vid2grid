"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Camera, UploadCloud } from "lucide-react";

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
  mode?: "upload" | "record";
}

/** Get a clip in: drop/choose a file, or record one from the webcam. */
export default function Source({ onFile, busy, mode = "upload" }: Props) {
  const [selection, setSelection] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (selection) URL.revokeObjectURL(selection.url); }, [selection]);
  const choose = (file: File) => {
    if ((!file.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v|ogv)$/i.test(file.name)) || file.size > 250 * 1024 * 1024) {
      setError("Choose an MP4, MOV, or WebM video smaller than 250 MB."); return;
    }
    setError(null); setSelection({ file, url: URL.createObjectURL(file) });
  };
  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="inline-error">{error}</p>}
      {selection ? <ClipPreview file={selection.file} url={selection.url} onBack={() => setSelection(null)} onConfirm={() => onFile(selection.file)} /> : mode === "upload" ? <Upload onFile={choose} busy={busy} /> : <Record onFile={choose} busy={busy} />}
    </div>
  );
}

function ClipPreview({ file, url, onBack, onConfirm }: { file: File; url: string; onBack: () => void; onConfirm: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return <div className="clip-preview"><div className="flow-steps"><span>1. Choose video</span><ArrowRight size={14} /><strong>2. Preview &amp; create</strong></div>
    <video src={url} controls playsInline preload="metadata" onError={() => setError("This video cannot be played. Try an MP4 or WebM file.")} onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration) && (e.currentTarget.duration < 1 || e.currentTarget.duration > 120)) setError("Choose a clip between 1 and 120 seconds."); }} />
    <div className="clip-file"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
    {error ? <p role="alert" className="inline-error">{error}</p> : <p className="dialog-note">Check that one dancer’s full body is visible. Next, we’ll track the movement and open your 3D score.</p>}
    <div className="dialog-actions"><button className="btn" onClick={onBack}>Choose another</button><button className="btn primary" disabled={!!error} onClick={onConfirm}>Create movement score <ArrowRight size={17} /></button></div>
  </div>;
}

function Upload({ onFile, busy }: Props) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f && !busy) onFile(f); }}
      className={`upload-zone ${over ? "is-over" : ""} ${busy ? "is-disabled" : ""}`}
    >
      <span className="upload-icon"><UploadCloud size={23} strokeWidth={1.5} /></span>
      <div className="upload-title">Drop your video here <span>or browse files</span></div>
      <div className="upload-formats mono">MP4, MOV, WEBM · UP TO 250 MB</div>
      <div className="upload-hint">5–30 seconds is ideal. One dancer, full body, still camera.</div>
      <input aria-label="Choose a video" type="file" accept="video/*" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} />
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
      if (recRef.current && recRef.current.state !== "inactive") {
        recRef.current.onstop = null;
        recRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t0 = performance.now();
    const id = setInterval(() => {
      const seconds = (performance.now() - t0) / 1000;
      setElapsed(seconds);
      if (seconds >= 119 && recRef.current?.state === "recording") { recRef.current.stop(); setRecording(false); }
    }, 100);
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
          <div className="absolute top-2 left-2 flex items-center gap-1.5 text-xs text-white bg-black/60 rounded px-2 py-1 mono">
            <span className="w-2 h-2 rounded-full bg-signal animate-pulse" /> REC {elapsed.toFixed(1)}s
          </div>
        )}
        {error && <div className="absolute inset-0 grid place-items-center text-sm text-signal">{error}</div>}
      </div>
      <div className="flex items-center gap-2 text-xs">
        {!recording ? (
          <button className="btn primary" disabled={!ready || busy} onClick={start}><Camera size={17} /> Start recording</button>
        ) : (
          <button className="btn" onClick={stop}>Stop &amp; preview</button>
        )}
        <span className="text-muted-foreground">Keep your whole body in frame. You can review the recording before creating a score.</span>
      </div>
    </div>
  );
}
