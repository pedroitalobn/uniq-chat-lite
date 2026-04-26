"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversationWS, type WSEvent } from "@/hooks/useConversationWS";

// useDesktopNotifications — registra Notification API + audio ping + badge
// no document.title quando chega msg.received. Conta unread enquanto a aba
// está fora de foco; zera quando volta.
//
// Hook único pra ser usado uma vez no shell da inbox. Não duplicar.
export function useDesktopNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [unreadCount, setUnreadCount] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const baseTitleRef = useRef<string>("");

  // Captura o título original ao montar
  useEffect(() => {
    if (typeof document !== "undefined") {
      baseTitleRef.current = document.title.replace(/^\(\d+\)\s*/, "");
    }
  }, []);

  // Atualiza badge no title conforme unreadCount
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) ${baseTitleRef.current}`;
    } else {
      document.title = baseTitleRef.current;
    }
  }, [unreadCount]);

  // Zera badge quando aba ganha foco
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") setUnreadCount(0);
    };
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("focus", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("focus", handler);
    };
  }, []);

  // Pede permissão sob demanda (não no mount — gesture-related)
  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "denied" as const;
    if (Notification.permission === "default") {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    }
    setPermission(Notification.permission);
    return Notification.permission;
  }, []);

  // Cria/reusa AudioContext lazily — alguns browsers exigem gesture pra
  // primeira criação; tentamos criar e ignoramos se falhar.
  const ensureAudio = useCallback(() => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  // Toca um beep suave de 2 notas (E5 + G5 ~120ms cada). Sem asset externo.
  const playPing = useCallback(() => {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [659.25, 783.99]; // E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = now + i * 0.13;
      const end = start + 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, end);
      osc.start(start);
      osc.stop(end);
    });
  }, [ensureAudio]);

  const showNotification = useCallback((title: string, body: string, tag?: string) => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (typeof document !== "undefined" && document.visibilityState === "visible") return; // aba ativa
    try {
      const n = new Notification(title, { body, tag, icon: "/favicon.ico" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* noop */
    }
  }, []);

  // Conecta no WS pra reagir a conversation.message inbound
  useConversationWS({
    prefixes: ["conversation."],
    onEvent: (evt: WSEvent) => {
      if (evt.type !== "conversation.message") return;
      const payload = (evt.payload ?? {}) as {
        message?: {
          direction?: string;
          sender_name?: string;
          content?: string;
          type?: string;
        };
      };
      const msg = payload.message;
      if (!msg || msg.direction !== "in") return;
      // aba ativa: só toca o ping suave (sem badge nem notification)
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        playPing();
        return;
      }
      // aba fora de foco: incrementa badge + notification + ping
      setUnreadCount((c) => c + 1);
      playPing();
      const sender = msg.sender_name || "Nova mensagem";
      const preview = previewFromContent(msg.content || "", msg.type || "text");
      showNotification(sender, preview);
    },
  });

  return { permission, requestPermission, unreadCount };
}

function previewFromContent(content: string, type: string): string {
  if (!content) {
    switch (type) {
      case "image": return "📷 Imagem";
      case "video": return "🎬 Vídeo";
      case "audio": return "🔊 Áudio";
      case "document": return "📄 Documento";
      case "sticker": return "😊 Sticker";
      case "location": return "📍 Localização";
      case "contact": return "👤 Contato";
      case "call": return "📞 Chamada";
      default: return "Nova mensagem";
    }
  }
  try {
    const obj = JSON.parse(content);
    if (typeof obj === "string") return obj.slice(0, 120);
    if (obj.text) return String(obj.text).slice(0, 120);
    if (obj.caption) return String(obj.caption).slice(0, 120);
  } catch { /* not JSON */ }
  return content.slice(0, 120);
}
