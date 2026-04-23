"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

export type WSEvent = {
  type: string;
  instance?: string;
  workspace?: string;
  user_id?: string;
  payload: unknown;
};

type Options = {
  /** Filter incoming events by prefix, e.g. "conversation.", "queue.", "presence." */
  prefixes?: string[];
  /** Called on every matching event. */
  onEvent: (event: WSEvent) => void;
};

function wsURL(token: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
  const wsBase = base.replace(/^http/, "ws");
  const sep = wsBase.includes("?") ? "&" : "?";
  return `${wsBase}/ws/events${sep}token=${encodeURIComponent(token)}`;
}

// useConversationWS connects to /ws/events and fires onEvent for events whose
// `type` matches one of the configured prefixes. Auto-reconnects with
// exponential backoff (1s → 2s → 5s → 10s → 30s cap). Tears down on unmount.
//
// Pass ONE onEvent callback per subscriber — the subscriber is responsible
// for dispatching into TanStack Query invalidations, Zustand stores, etc.
export function useConversationWS({ prefixes = ["conversation.", "queue.", "presence."], onEvent }: Options) {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const onEventRef = useRef(onEvent);
  const prefixesRef = useRef(prefixes);

  // Always point to the latest callback without re-opening the socket.
  useEffect(() => {
    onEventRef.current = onEvent;
    prefixesRef.current = prefixes;
  }, [onEvent, prefixes]);

  useEffect(() => {
    if (!token) return;
    let ws: WebSocket | null = null;
    let cancelled = false;
    let retryMs = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket(wsURL(token));
      } catch {
        scheduleReconnect();
        return;
      }
      ws.onopen = () => {
        retryMs = 1000;
      };
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as WSEvent;
          if (!data?.type) return;
          const match = prefixesRef.current.some((p) => data.type.startsWith(p));
          if (match) onEventRef.current(data);
        } catch {
          /* ignore non-JSON frames */
        }
      };
      ws.onerror = () => {
        try { ws?.close(); } catch { /* noop */ }
      };
      ws.onclose = () => {
        if (!cancelled) scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      reconnectTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* noop */ }
    };
  }, [token]);
}
