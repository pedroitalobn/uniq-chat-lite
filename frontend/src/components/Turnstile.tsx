"use client";

import Script from "next/script";
import { useEffect, useId, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: string | HTMLElement,
        opts: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
          appearance?: "always" | "execute" | "interaction-only";
        },
      ) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

interface TurnstileProps {
  onVerify: (token: string) => void;
  onError?: () => void;
  theme?: "light" | "dark" | "auto";
}

/**
 * Cloudflare Turnstile widget. Renderiza invisível por padrão (appearance:
 * interaction-only) — só aparece se o desafio precisar de interação humana.
 *
 * Quando NEXT_PUBLIC_TURNSTILE_SITE_KEY está vazio, retorna null (dev/staging
 * sem captcha) — combina com o backend que faz bypass quando
 * TURNSTILE_SECRET_KEY também está vazio.
 */
export function Turnstile({ onVerify, onError, theme = "auto" }: TurnstileProps) {
  const elementId = useId();
  const widgetIdRef = useRef<string | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    const tryRender = () => {
      if (cancelled || !window.turnstile) return;
      const el = document.getElementById(elementId);
      if (!el || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(el, {
        sitekey: siteKey,
        theme,
        appearance: "interaction-only",
        callback: onVerify,
        "error-callback": () => onError?.(),
        "expired-callback": () => {
          if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
        },
      });
    };
    // Script pode ainda não ter carregado — poll curto.
    const interval = setInterval(() => {
      if (window.turnstile) {
        clearInterval(interval);
        tryRender();
      }
    }, 100);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, elementId, theme, onVerify, onError]);

  if (!siteKey) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
      <div id={elementId} />
    </>
  );
}
