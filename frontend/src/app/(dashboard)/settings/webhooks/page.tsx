"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Esta rota foi consolidada com /integrations?tab=webhook.
 * Mantemos o path válido mas apenas redirecionamos para garantir que exista
 * uma única interface canônica de webhooks globais.
 */
export default function WebhooksSettingsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/integrations?tab=webhook");
  }, [router]);

  return (
    <div
      className="min-h-screen flex items-center justify-center gap-2"
      style={{ color: "var(--text-3)" }}
    >
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-sm">Redirecionando…</span>
    </div>
  );
}
