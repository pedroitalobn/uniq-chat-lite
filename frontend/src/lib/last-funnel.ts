"use client";

// useLastFunnel — persiste o último funil selecionado em localStorage por
// workspace, pra que ao recarregar/voltar pra CRM o user volte ao funil
// que estava trabalhando. Antes sempre caía no primeiro/default — irritante
// pra quem trabalha 100% num funil específico (ex: "Vendas SP").

import { useEffect, useRef } from "react";

const STORAGE_KEY = "uniq.lastFunnelByWorkspace";

type Map = Record<string, string>;

function readMap(): Map {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Map) : {};
  } catch {
    return {};
  }
}

function writeMap(m: Map) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    // localStorage cheio / desabilitado → silencioso, não vale travar UI.
  }
}

/** Lê o último funil persistido pra este workspace (ou string vazia). */
export function readLastFunnelId(workspaceId: string | undefined): string {
  if (!workspaceId) return "";
  return readMap()[workspaceId] || "";
}

/** Persiste o funil selecionado quando muda. Use pareado com setFunnelId. */
export function useLastFunnelPersistor(workspaceId: string | undefined, funnelId: string) {
  const last = useRef("");
  useEffect(() => {
    if (!workspaceId || !funnelId) return;
    if (last.current === funnelId) return;
    last.current = funnelId;
    const m = readMap();
    if (m[workspaceId] === funnelId) return;
    m[workspaceId] = funnelId;
    writeMap(m);
  }, [workspaceId, funnelId]);
}
