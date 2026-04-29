"use client";

// Preferência de modelo do Uniq AI — persiste em localStorage para
// sobreviver a recargas e ser compartilhada entre chat-panel e Dynamic Island.

const PREF_KEY = "uniqai_model_pref";

export interface ModelPreference {
  integrationId: string;
  integrationName: string;
  provider: string;
  model: string;
}

export function loadModelPref(): ModelPreference | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw ? (JSON.parse(raw) as ModelPreference) : null;
  } catch {
    return null;
  }
}

export function saveModelPref(pref: ModelPreference) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREF_KEY, JSON.stringify(pref));
}
