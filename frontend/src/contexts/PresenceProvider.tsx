"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { presenceApi, type PresenceStatus } from "@/lib/api";
import { useWorkspace } from "./WorkspaceContext";

type Ctx = {
  status: PresenceStatus;
  setStatus: (s: PresenceStatus, reason?: string) => void;
  isLoading: boolean;
};

const defaultCtx: Ctx = {
  status: "offline",
  setStatus: () => {},
  isLoading: true,
};

const PresenceContext = createContext<Ctx>(defaultCtx);

// Heartbeat cadence — needs to be well under the backend's
// presenceHeartbeatTTL (2min) so agents never get marked offline while the
// tab is open and active.
const HEARTBEAT_MS = 60_000;
// Inactivity threshold before switching to "away" automatically.
const IDLE_MS = 5 * 60_000;

// PresenceProvider keeps the agent's UserPresence row fresh so DispatchService
// can actually assign them tickets.
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const { currentWorkspace } = useWorkspace();
  const [status, setStatusState] = useState<PresenceStatus>("offline");
  const [isLoading, setIsLoading] = useState(true);
  const lastActivityRef = useRef<number>(Date.now());
  const wsId = currentWorkspace?.id;
  const userId = session?.user?.id;

  // Send a heartbeat at the configured cadence. When the tab is hidden OR
  // the user hasn't interacted for IDLE_MS, send status=away instead of
  // online. `PUT /me/presence` both updates status AND refreshes
  // last_seen_at — a single call per cycle suffices.
  useEffect(() => {
    if (!wsId || !userId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ["mousemove", "keydown", "mousedown", "touchstart", "focus"];
    events.forEach((e) => window.addEventListener(e, markActive, { passive: true }));

    const computeStatus = (): PresenceStatus => {
      if (document.hidden) return "away";
      if (Date.now() - lastActivityRef.current > IDLE_MS) return "away";
      return "online";
    };

    const tick = async () => {
      if (cancelled) return;
      const next = computeStatus();
      try {
        await presenceApi.updateMine(wsId, { status: next });
        setStatusState(next);
      } catch {
        // swallow — backend sweeper will mark offline after TTL anyway
      }
      setIsLoading(false);
    };

    tick();
    const interval = setInterval(tick, HEARTBEAT_MS);

    // On tab close, best-effort send offline. `sendBeacon` survives unload.
    const onUnload = () => {
      if (!wsId) return;
      try {
        const url = `${process.env.NEXT_PUBLIC_API_URL || ""}/v1/me/presence`;
        const blob = new Blob([JSON.stringify({ status: "offline" })], {
          type: "application/json",
        });
        // We can't set a Bearer header in sendBeacon — rely on the cookie that
        // the NextAuth session sets; the backend middleware accepts it.
        navigator.sendBeacon(url, blob);
      } catch {
        /* noop */
      }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("visibilitychange", tick);

    return () => {
      cancelled = true;
      clearInterval(interval);
      events.forEach((e) => window.removeEventListener(e, markActive));
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [wsId, userId]);

  const setStatus = (s: PresenceStatus, reason?: string) => {
    if (!wsId) return;
    setStatusState(s);
    presenceApi.updateMine(wsId, { status: s, away_reason: reason }).catch(() => {});
  };

  return (
    <PresenceContext.Provider value={{ status, setStatus, isLoading }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  return useContext(PresenceContext);
}
