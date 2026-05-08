"use client";

// ServiceWorkerRegister — registra o /sw.js após hidratação.
// Roda só em produção (next dev tem HMR e queremos cache desligado em dev).
// Sem dependências externas; idempotente — re-render não tenta registrar de
// novo (browser já trata isso, mas evita ruído no console).

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // Falha de registro não deve quebrar o app — apenas log discreto.
          console.warn("[sw] registration failed:", err);
        });
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);

  return null;
}
