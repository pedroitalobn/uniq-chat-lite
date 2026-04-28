"use client";

// Player de áudio compacto que mostra a duração CORRETAMENTE desde o
// primeiro frame — corrige o bug do <audio controls> nativo onde
// arquivos opus/webm enviados pelo WhatsApp aparecem com duração
// 0:00 ou Infinity até a primeira reprodução completa.
//
// Workaround conhecido: forçar audio.currentTime pra um valor enorme
// → o browser computa o duration real → seta currentTime de volta a 0.

import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";

interface Props {
  url: string;
  className?: string;
}

export function AudioPlayer({ url, className }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seekFixed, setSeekFixed] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onMetadata = () => {
      // Se duration veio finito e válido, usa direto.
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
        return;
      }
      // Fallback: força browser a "ler" até o final pra computar duration.
      // O hack: setar currentTime pra um número absurdo → browser ajusta
      // pra duração real → escutamos e voltamos pra 0.
      if (!seekFixed) {
        setSeekFixed(true);
        el.currentTime = 1e10;
      }
    };

    const onDurationChange = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
      }
    };

    const onTimeUpdate = () => {
      // Após o seek-hack reportar duração real, volta currentTime pra 0
      if (seekFixed && Number.isFinite(el.duration) && el.duration > 0 && el.currentTime > el.duration) {
        el.currentTime = 0;
        setDuration(el.duration);
        setSeekFixed(false);
      } else {
        setCurrent(el.currentTime);
      }
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
    };

    el.addEventListener("loadedmetadata", onMetadata);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("loadedmetadata", onMetadata);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [seekFixed]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const v = parseFloat(e.target.value);
    el.currentTime = v;
    setCurrent(v);
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-full px-2 py-1.5 transition-colors ${className || ""}`}
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", maxWidth: 260 }}
    >
      <audio ref={audioRef} src={url} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        className="flex h-7 w-7 items-center justify-center rounded-full transition-transform active:scale-95"
        style={{ background: "var(--green)", color: "var(--green-fg)" }}
        title={playing ? "Pausar" : "Tocar"}
      >
        {playing ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current pl-0.5" />}
      </button>
      <input
        type="range"
        min={0}
        max={duration ?? 0}
        step={0.1}
        value={current}
        onChange={seek}
        className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--green) 0%, var(--green) ${duration ? (current / duration) * 100 : 0}%, var(--surface-3) ${duration ? (current / duration) * 100 : 0}%, var(--surface-3) 100%)`,
        }}
      />
      <span className="text-[10px] font-mono tabular-nums shrink-0" style={{ color: "var(--text-3)" }}>
        {duration ? fmt(playing || current > 0 ? current : duration) : "—:—"}
      </span>
    </div>
  );
}
