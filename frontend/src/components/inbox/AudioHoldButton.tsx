"use client";

// AudioHoldButton — botão estilo WhatsApp: pressionar e segurar para gravar,
// soltar para enviar, arrastar para cima até o cadeado para travar. Diferente do
// AudioRecorderButton (toque-pra-gravar), esse é otimizado pra mobile.
//
// UX:
//   • touchstart      → pede permissão + começa gravar (vibra)
//   • touchend        → para e entrega o File (a menos que cancelado/travado)
//   • touchmove ←     → entra em modo "soltar pra cancelar" (>80px à esquerda)
//   • touchmove ↑     → trava no cadeado (>80px pra cima), segue gravando
//   • duração mínima  → 600ms; toques rápidos são ignorados (toast: "segure")
//
// Quando gravando, o componente expande pra ocupar a largura toda da row do
// composer com timer + indicador "← cancelar / ↑ travar".

import { useEffect, useRef, useState } from "react";
import { Lock, Mic, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { haptic } from "@/lib/haptics";

const CANCEL_THRESHOLD = 80; // px à esquerda = cancela
const LOCK_THRESHOLD = 80; // px pra cima = trava
const MIN_DURATION_MS = 600;
const MAX_DURATION_S = 300;

export function AudioHoldButton({
  onRecorded,
  disabled,
  size = 44,
}: {
  onRecorded: (file: File) => void;
  disabled?: boolean;
  /** Diâmetro do botão circular (default 44 — área de toque iOS). */
  size?: number;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [willCancel, setWillCancel] = useState(false);
  const [locked, setLocked] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const startedAtRef = useRef<number>(0);
  const cancelRef = useRef(false);
  const lockedRef = useRef(false);
  const startTouchRef = useRef<{ x: number; y: number } | null>(null);
  const mimeRef = useRef<string>("");

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  function pickMimeType(): string {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ];
    for (const c of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }

  async function start(x: number, y: number) {
    if (recording || disabled) return;
    startTouchRef.current = { x, y };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      cancelRef.current = false;
      lockedRef.current = false;
      setLocked(false);
      const mime = pickMimeType();
      mimeRef.current = mime;
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (cancelRef.current) {
          chunksRef.current = [];
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        if (blob.size === 0) return;
        const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: blob.type });
        onRecorded(file);
      };
      rec.start(250);
      startedAtRef.current = Date.now();
      setSeconds(0);
      setWillCancel(false);
      setLocked(false);
      setRecording(true);
      haptic.success();
      tickRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_DURATION_S) stop(false);
      }, 250);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "permissão negada";
      toast.error(`Microfone: ${msg}`);
    }
  }

  function stop(cancelled: boolean) {
    if (!recording) {
      // Toque rápido sem gravar — mostra dica.
      toast.info("Mantenha pressionado para gravar");
      return;
    }
    const elapsed = Date.now() - startedAtRef.current;
    if (elapsed < MIN_DURATION_MS && !cancelled) {
      // Soltou cedo demais — cancela e instrui.
      cancelled = true;
      toast.info("Mantenha pressionado para gravar");
    }
    cancelRef.current = cancelled;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setRecording(false);
    setWillCancel(false);
    setLocked(false);
    lockedRef.current = false;
    if (cancelled) haptic.warning();
    else haptic.tap();
    recorderRef.current?.stop();
    recorderRef.current = null;
    startTouchRef.current = null;
  }

  function onMove(x: number, y: number) {
    if (lockedRef.current) return;
    if (!startTouchRef.current) return;
    const dx = startTouchRef.current.x - x;
    const dy = startTouchRef.current.y - y;
    if (dy > LOCK_THRESHOLD && dx < CANCEL_THRESHOLD) {
      lockedRef.current = true;
      setLocked(true);
      setWillCancel(false);
      haptic.success();
      return;
    }
    // Dedo foi pra esquerda mais que threshold → soltar cancela.
    setWillCancel(dx > CANCEL_THRESHOLD && dy < LOCK_THRESHOLD);
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  }

  if (recording) {
    return (
      <div
        className="flex items-center gap-2 rounded-full px-3 flex-1"
        style={{
          height: size,
          background: willCancel
            ? "rgba(239,68,68,0.18)"
            : locked ? "rgba(37, 99, 235,0.12)" : "rgba(239,68,68,0.10)",
          border: `1px solid ${
            willCancel
              ? "rgba(239,68,68,0.55)"
              : locked ? "rgba(37, 99, 235,0.35)" : "rgba(239,68,68,0.30)"
          }`,
        }}
        // touchmove/end aqui também — em alguns devices o touchend dispara no
        // elemento atual mesmo se o dedo se moveu.
        onTouchMove={(e) => onMove(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={() => {
          if (!lockedRef.current) stop(willCancel);
        }}
        onTouchCancel={() => stop(true)}
      >
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "#ef4444" }} />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: "#ef4444" }} />
        </span>
        <span className="text-sm font-mono tabular-nums flex-shrink-0" style={{ color: "#ef4444" }}>
          {fmt(seconds)}
        </span>
        <span
          className="flex-1 text-xs truncate text-right"
          style={{ color: willCancel ? "#ef4444" : locked ? "#2563EB" : "var(--text-3)" }}
        >
          {willCancel ? "Solte para cancelar" : locked ? "Gravando livre" : "← cancelar · ↑ travar"}
        </span>
        {willCancel && <Trash2 className="h-4 w-4 flex-shrink-0" style={{ color: "#ef4444" }} />}
        {!willCancel && !locked && (
          <Lock className="h-4 w-4 flex-shrink-0" style={{ color: "var(--text-3)" }} />
        )}
        {locked && (
          <>
            <button
              type="button"
              onClick={() => stop(true)}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
              style={{ background: "rgba(239,68,68,0.14)", color: "#ef4444" }}
              aria-label="Cancelar gravação"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => stop(false)}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
              style={{ background: "var(--green)", color: "var(--green-fg, #03170a)" }}
              aria-label="Enviar áudio"
            >
              <Send className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label="Gravar áudio (pressione e segure)"
      onTouchStart={(e) => {
        e.preventDefault();
        const t = e.touches[0];
        start(t.clientX, t.clientY);
      }}
      onTouchMove={(e) => onMove(e.touches[0].clientX, e.touches[0].clientY)}
      onTouchEnd={(e) => {
        e.preventDefault();
        stop(willCancel);
      }}
      onTouchCancel={() => stop(true)}
      // Desktop fallback — click rápido só mostra a dica.
      onClick={() => toast.info("No mobile, segure este botão para gravar")}
      className="flex items-center justify-center rounded-full transition-colors disabled:opacity-40 select-none"
      style={{
        width: size,
        height: size,
        background: "var(--green)",
        color: "var(--green-fg, #03170a)",
        boxShadow: "0 2px 8px rgba(37, 99, 235,0.25)",
        touchAction: "none",
      }}
    >
      <Mic className="h-5 w-5" />
    </button>
  );
}
