"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  onRecorded: (file: File) => void;
  disabled?: boolean;
  title?: string;
}

// Botão de gravar áudio. Click → começa a gravar (mostra timer + waveform mock)
// → click de novo → para e entrega o File pro composer (mp4/m4a webm).
//
// Tenta MIME types em ordem de compatibilidade WhatsApp:
//   1. audio/mp4         — iOS Safari nativo, melhor compat WhatsApp
//   2. audio/webm;codecs=opus — Chrome/Firefox padrão
//   3. audio/webm        — fallback genérico
export function AudioRecorderButton({ onRecorded, disabled, title = "Gravar áudio" }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const startedAtRef = useRef<number>(0);
  const cancelRef = useRef(false);

  useEffect(() => {
    return () => {
      // cleanup ao desmontar
      stopStream();
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function pickMimeType(): string {
    const candidates = [
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ];
    for (const c of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }

  async function start() {
    if (recording || disabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      cancelRef.current = false;

      const mime = pickMimeType();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stopStream();
        if (cancelRef.current) {
          chunksRef.current = [];
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        if (blob.size === 0) {
          toast.error("Gravação vazia — segure por mais tempo");
          return;
        }
        const ext = mime.includes("mp4") ? "m4a" : mime.includes("webm") ? "webm" : "ogg";
        const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: blob.type });
        onRecorded(file);
      };

      rec.start(250);
      startedAtRef.current = Date.now();
      setSeconds(0);
      setRecording(true);
      tickRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        // Hard cap em 5min — WhatsApp aceita mais mas força o user a moderar
        if (elapsed >= 300) stop();
      }, 250);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "permissão negada";
      toast.error(`Não foi possível acessar microfone: ${msg}`);
    }
  }

  function stop() {
    if (!recording) return;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setRecording(false);
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  function cancel() {
    cancelRef.current = true;
    stop();
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  }

  if (recording) {
    return (
      <div className="flex items-center gap-1.5 rounded-md px-2 h-10"
        style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)" }}>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "#ef4444" }} />
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#ef4444" }} />
        </span>
        <span className="text-xs font-mono tabular-nums" style={{ color: "#ef4444" }}>
          {fmt(seconds)}
        </span>
        <button
          type="button"
          onClick={cancel}
          title="Cancelar"
          className="rounded p-1 hover:bg-white/5"
          style={{ color: "hsl(240 8% 60%)" }}>
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={stop}
          title="Parar e anexar"
          className="rounded p-1 hover:bg-white/5"
          style={{ color: "#ef4444" }}>
          <Square className="h-3.5 w-3.5 fill-current" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      title={title}
      className="flex h-10 w-10 items-center justify-center rounded-md transition-colors disabled:opacity-40"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-default)",
        color: "hsl(240 8% 52%)",
      }}>
      <Mic className="h-4 w-4" />
    </button>
  );
}
