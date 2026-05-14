"use client";

// ContactInboxCTA — botão "Inbox" no row do contato. Se o contato tiver
// `instance_id` (origem), abre direto a conversa nessa instância. Se não
// tiver (cadastro manual sem origem), abre um popover com seletor das
// instâncias do workspace para escolher por onde iniciar.
//
// Sem isso, antes o atendente que via um contato no CRM precisava sair
// do CRM, achar a conversa no inbox manualmente — fricção alta.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, X } from "lucide-react";
import { conversationsApi, instancesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

type Instance = { id: string; name: string; channel?: string; status?: string };

export function ContactInboxCTA({
  contactId,
  contactPhone,
  preferredInstanceId,
  size = "sm",
}: {
  contactId: string;
  contactPhone?: string;
  preferredInstanceId?: string;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const { data: instances = [] } = useQuery<Instance[]>({
    queryKey: ["instances", wsId],
    queryFn: () => instancesApi.list(undefined, wsId).then((r) => (r.data as Instance[]) || []),
    enabled: !!wsId && open,
    staleTime: 60_000,
  });

  const goToConversation = async (instanceId: string) => {
    setOpen(false);
    if (!wsId) return;
    try {
      // Tenta achar conversa existente; se não houver, cai pra busca livre.
      const r = await conversationsApi.list(wsId, { instance_id: instanceId, contact_id: contactId, limit: 1 });
      const item = (r.data?.items || r.data || [])[0];
      if (item?.id) {
        router.push(`/inbox/${item.id}`);
      } else {
        // Sem conversa ainda — vai pro inbox filtrado por instância+contato.
        const params = new URLSearchParams();
        params.set("instance", instanceId);
        if (contactPhone) params.set("phone", contactPhone);
        router.push(`/inbox?${params.toString()}`);
      }
    } catch {
      router.push("/inbox");
    }
  };

  const onClick = () => {
    if (preferredInstanceId) {
      goToConversation(preferredInstanceId);
      return;
    }
    setOpen((v) => !v);
  };

  const iconSize = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";
  const padding = size === "md" ? "p-2" : "p-1.5";

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={onClick}
        className={`${padding} rounded-lg transition-all`}
        title={preferredInstanceId ? "Abrir no inbox" : "Falar com o contato no inbox"}
        style={{ color: "#2563EB", background: "rgba(37, 99, 235,0.08)", border: "1px solid rgba(37, 99, 235,0.2)" }}
      >
        <MessageSquare className={iconSize} />
      </button>

      {open && !preferredInstanceId && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-lg overflow-hidden min-w-[220px]"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--surface-border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--surface-border)" }}>
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
              Falar via instância
            </span>
            <button onClick={() => setOpen(false)} style={{ color: "var(--text-3)" }}>
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="py-1 max-h-72 overflow-y-auto">
            {instances.length === 0 && (
              <p className="px-3 py-2 text-[11px]" style={{ color: "var(--text-3)" }}>
                Nenhuma instância conectada.
              </p>
            )}
            {instances.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => goToConversation(i.id)}
                className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-2"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: i.status === "connected" ? "#2563EB" : "#71717a" }} />
                <span className="text-xs flex-1 truncate" style={{ color: "var(--text-1)" }}>{i.name}</span>
                {i.channel && <span className="text-[10px]" style={{ color: "var(--text-3)" }}>{i.channel}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
