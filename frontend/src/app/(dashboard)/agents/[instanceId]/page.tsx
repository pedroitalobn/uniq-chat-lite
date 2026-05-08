"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// Quando o user navega pra /agents/[instanceId] sem especificar agente,
// redirecionamos pro Studio do agente primário. "primary" é um id especial
// que o handler de Studio interpreta como "buscar agente primário da
// instância" (omite o param agent_id no GET).
export default function AgentInstanceIndex() {
  const params = useParams<{ instanceId: string }>();
  const router = useRouter();

  useEffect(() => {
    if (params.instanceId) {
      router.replace(`/agents/${params.instanceId}/primary`);
    }
  }, [params.instanceId, router]);

  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} />
    </div>
  );
}
