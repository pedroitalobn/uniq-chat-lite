"use client";

// Player de áudio estilo WhatsApp — pill verde com waveform sintético
// (barras decorativas baseadas em hash do URL pra manter visual estável
// entre renders sem precisar processar o áudio inteiro).
//
// Workaround duração: muitos áudios opus/webm aparecem com duration
// Infinity até primeira reprodução — fix via seek-to-end.
//
// UX mobile-style: botão de velocidade (1x/1.5x/2x) à direita, tipo
// WhatsApp Web/iOS. Pra clicar no waveform e fazer seek mantemos o
// comportamento padrão.

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";

interface Props {
  url: string;
  className?: string;
  /** Cor do bubble pra ajustar contraste do player. "out" usa verde escuro
   * (mensagem do agente), "in" usa cinza padrão WhatsApp. */
  variant?: "in" | "out";
}

const BAR_COUNT = 28;
const SPEEDS = [1, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];
const SPEED_KEY = "uniq.audio.playback-rate";

// Hash simples de string → número [0, 1]. Usado pra gerar barras
// determinísticas por URL (mesma URL = mesmo waveform).
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function generateBars(url: string): number[] {
  // PRNG determinístico baseado no hash da URL — barras estáveis.
  let seed = hashStr(url);
  return Array.from({ length: BAR_COUNT }, () => {
    seed = (seed * 9301 + 49297) % 233280;
    const v = seed / 233280;
    // Curva pra ficar mais bonito (centro mais alto que pontas)
    return 0.25 + Math.pow(v, 1.5) * 0.75;
  });
}

function loadStoredSpeed(): Speed {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(SPEED_KEY);
  const n = Number(raw);
  return SPEEDS.includes(n as Speed) ? (n as Speed) : 1;
}

export function AudioPlayer({ url, className, variant = "in" }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seekFixed, setSeekFixed] = useState(false);
  const [speed, setSpeed] = useState<Speed>(() => loadStoredSpeed());

  const bars = useMemo(() => generateBars(url), [url]);

  // Cores estilo WhatsApp:
  // - bubble entrante: cinza com play verde
  // - bubble saindo: verde escuro com play branco
  const colors = variant === "out"
    ? {
        bg: "#005c4b",
        playBg: "#ffffff",
        playFg: "#005c4b",
        barIdle: "rgba(255,255,255,0.35)",
        barActive: "#ffffff",
        text: "rgba(255,255,255,0.85)",
        speedBg: "rgba(255,255,255,0.18)",
        speedFg: "#ffffff",
      }
    : {
        bg: "#1f2c34",
        playBg: "#00a884",
        playFg: "#ffffff",
        barIdle: "rgba(255,255,255,0.25)",
        barActive: "#53bdeb",
        text: "rgba(255,255,255,0.7)",
        speedBg: "rgba(255,255,255,0.12)",
        speedFg: "#ffffff",
      };

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onMetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
        return;
      }
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
    const onRateChange = () => {
      const r = el.playbackRate;
      if (SPEEDS.includes(r as Speed)) setSpeed(r as Speed);
    };

    el.addEventListener("loadedmetadata", onMetadata);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("ratechange", onRateChange);

    return () => {
      el.removeEventListener("loadedmetadata", onMetadata);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("ratechange", onRateChange);
    };
  }, [seekFixed]);

  // Aplica a velocidade salva no <audio> quando ele monta e quando muda.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SPEED_KEY, String(next));
    }
  };

  const onBarClick = (idx: number) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const t = (idx / BAR_COUNT) * duration;
    el.currentTime = t;
    setCurrent(t);
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  const progress = duration ? current / duration : 0;
  const activeBarIdx = Math.round(progress * BAR_COUNT);

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${className || ""}`}
      style={{ background: colors.bg, maxWidth: 320 }}
    >
      <audio ref={audioRef} src={url} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
        style={{ background: colors.playBg, color: colors.playFg }}
        title={playing ? "Pausar" : "Tocar"}
      >
        {playing ? (
          <Pause className="h-4 w-4 fill-current" />
        ) : (
          <Play className="h-4 w-4 fill-current pl-0.5" />
        )}
      </button>

      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div
          className="flex items-end gap-[2px] h-7 cursor-pointer"
          onClick={(e) => {
            // mapeia clique horizontal pra barra
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const idx = Math.floor((x / rect.width) * BAR_COUNT);
            onBarClick(idx);
          }}
        >
          {bars.map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-full transition-colors"
              style={{
                height: `${Math.round(h * 28)}px`,
                background: i < activeBarIdx ? colors.barActive : colors.barIdle,
                minWidth: 2,
              }}
            />
          ))}
        </div>
        <span
          className="text-[10px] font-mono tabular-nums leading-none"
          style={{ color: colors.text }}
        >
          {duration ? fmt(playing || current > 0 ? current : duration) : "—:—"}
        </span>
      </div>

      {/* Botão de velocidade — só visível depois que algo tocou pelo menos
          uma vez OU se velocidade ≠ 1x. Visual estilo WhatsApp mobile. */}
      <button
        type="button"
        onClick={cycleSpeed}
        className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold tabular-nums leading-none"
        style={{
          background: colors.speedBg,
          color: colors.speedFg,
          minWidth: 32,
          opacity: speed !== 1 || playing || current > 0 ? 1 : 0.7,
        }}
        title={`Velocidade ${speed}x — clique para alternar`}
      >
        {speed.toString().replace(/\.0$/, "")}x
      </button>
    </div>
  );
}
