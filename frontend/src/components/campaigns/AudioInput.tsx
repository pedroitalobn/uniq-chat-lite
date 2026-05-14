"use client";

// AudioInput — input de áudio com 2 modos: upload de arquivo OU
// gravação ao vivo via MediaRecorder. Devolve o resultado pra o pai
// como `File` (uniformizado pra encaixar no fluxo de upload existente).
//
// Usado no builder de campanhas quando message_type = "audio".

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Play, Pause, Upload, RotateCcw, CheckCircle2 } from "lucide-react";

type Mode = "idle" | "recording" | "preview";

export function AudioInput({
  file,
  onChange,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [mode, setMode] = useState<Mode>(file ? "preview" : "idle");
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Atualiza preview URL quando o file muda — pra suportar tanto upload
  // como gravação. Cleanup pra não vazar object URL.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setMode("idle");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setMode("preview");
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Cronômetro durante gravação.
  useEffect(() => {
    if (mode !== "recording") return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [mode]);

  // Cleanup definitivo (quando componente desmonta no meio de gravação).
  useEffect(() => () => stopStream(), []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Seu navegador não suporta gravação de áudio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMimeType();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const ext = (blob.type.split("/")[1] || "webm").split(";")[0];
        const audioFile = new File([blob], `gravacao-${Date.now()}.${ext}`, { type: blob.type });
        onChange(audioFile);
        stopStream();
      };
      recorder.start();
      recorderRef.current = recorder;
      setElapsed(0);
      setMode("recording");
    } catch (err) {
      setError("Permissão de microfone negada. Habilite nas configurações do navegador.");
      stopStream();
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  };

  const reset = () => {
    onChange(null);
    setElapsed(0);
    setMode("idle");
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────
  if (mode === "preview" && previewUrl && file) {
    return (
      <div
        className="rounded-xl p-4 flex flex-col gap-3"
        style={{ background: "rgba(37, 99, 235,0.04)", border: "1px solid rgba(37, 99, 235,0.30)" }}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" style={{ color: "var(--green)" }} />
          <span className="text-xs font-medium truncate flex-1" style={{ color: "var(--text-1)" }}>
            {file.name}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
            {formatBytes(file.size)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "var(--green)", color: "#03170a" }}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <audio
            ref={audioRef}
            src={previewUrl}
            onEnded={() => setIsPlaying(false)}
            onPause={() => setIsPlaying(false)}
            controls
            className="flex-1 h-8"
            style={{ filter: "invert(0.85)" }}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium"
            style={{
              background: "var(--input)",
              border: "1px solid var(--border-default)",
              color: "var(--text-2)",
            }}
          >
            <RotateCcw className="w-3 h-3" /> Trocar
          </button>
        </div>
      </div>
    );
  }

  if (mode === "recording") {
    return (
      <div
        className="rounded-xl p-4 flex flex-col items-center gap-3"
        style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.30)" }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-medium" style={{ color: "var(--text-1)" }}>
            Gravando…
          </span>
          <span className="text-xs tabular-nums" style={{ color: "var(--text-3)" }}>
            {formatTime(elapsed)}
          </span>
        </div>
        <button
          type="button"
          onClick={stopRecording}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium"
          style={{ background: "#ef4444", color: "var(--text-1)" }}
        >
          <Square className="w-3.5 h-3.5" /> Parar e usar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className="rounded-xl p-4 flex flex-col items-center gap-3"
        style={{
          border: "2px dashed var(--border-strong)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <Mic className="w-6 h-6" style={{ color: "var(--text-3)" }} />
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          Envie um arquivo de áudio ou grave agora.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
            style={{
              background: "var(--input)",
              border: "1px solid var(--border-default)",
              color: "var(--text-2)",
            }}
          >
            <Upload className="w-3.5 h-3.5" /> Enviar arquivo
          </button>
          <button
            type="button"
            onClick={startRecording}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
            style={{ background: "var(--green)", color: "#03170a" }}
          >
            <Mic className="w-3.5 h-3.5" /> Gravar agora
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onChange(f);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <p className="text-[11px]" style={{ color: "#ef4444" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

function formatTime(s: number) {
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
