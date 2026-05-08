// share.ts — Native Web Share API com fallback pra clipboard.
// Em mobile (iOS/Android) abre o seletor nativo (apps instalados).
// Em desktop ou navegadores sem suporte, copia pra clipboard e mostra
// toast (caller pode passar callback onFallback pra UI custom).

import { toast } from "sonner";

export async function nativeShare(opts: {
  title?: string;
  text?: string;
  url?: string;
  /** Texto do toast quando cair pro fallback (clipboard). Default "Link copiado". */
  fallbackToast?: string;
}): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const { title, text, url, fallbackToast = "Link copiado" } = opts;
  // Native share — disponível em iOS Safari, Android Chrome, alguns mais.
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      // AbortError = usuário cancelou o sheet — não é erro real.
      if ((err as { name?: string })?.name === "AbortError") return "cancelled";
      // Outros erros caem no fallback.
    }
  }
  // Fallback: copia pra clipboard.
  const payload = url || text || title || "";
  if (!payload) return "failed";
  try {
    await navigator.clipboard.writeText(payload);
    toast.success(fallbackToast);
    return "copied";
  } catch {
    toast.error("Não consegui copiar — selecione manualmente");
    return "failed";
  }
}
