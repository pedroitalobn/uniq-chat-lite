"use client";

// Modal de seleção de template pra criar jornada pré-configurada.
// Vivia em /agents/page.tsx::TemplatesDialog. Movido pra features/journeys/
// quando o módulo virou top-level (Apr/26) e o botão "Templates" saiu do
// header do chat e migrou pra /journeys.

import { useQuery } from "@tanstack/react-query";
import { LayoutTemplate, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { journeysApi } from "@/lib/api";

export function TemplatesDialog({
  onClose, instanceId,
}: {
  onClose: () => void;
  instanceId?: string;
}) {
  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ["journey-templates"],
    queryFn: async () => {
      const r = await journeysApi.listTemplates();
      return r.data?.templates ?? r.data ?? [];
    },
  });

  const pick = async (slug: string, name?: string) => {
    try {
      const r = await journeysApi.createFromTemplate(slug, instanceId, name);
      const id = r.data?.id;
      if (!id) throw new Error("id ausente");
      toast.success("Jornada criada a partir do template");
      window.location.href = `/journeys/${id}`;
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Falha ao criar jornada");
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl p-5 sm:p-6 shadow-2xl max-h-[85vh] overflow-hidden flex flex-col"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-medium" style={{ color: "hsl(240 15% 93%)" }}>Começar de um template</h2>
            <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 54%)" }}>
              Modelos prontos com flow configurado. Edite depois no canvas.
            </p>
          </div>
          <button onClick={onClose} style={{ color: "hsl(240 8% 38%)" }} className="hover:opacity-70">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12" style={{ color: "var(--text-3)" }}>
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <p className="text-center text-xs py-12" style={{ color: "hsl(240 8% 38%)" }}>
              Nenhum template disponível ainda.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {templates.map((t: any) => (
                <button
                  key={t.slug || t.id}
                  onClick={() => pick(t.slug, t.name)}
                  className="text-left rounded-xl p-4 transition-all hover:scale-[1.01]"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid hsl(240 12% 14%)" }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <LayoutTemplate className="w-4 h-4" style={{ color: "var(--green)" }} />
                    <span className="font-medium text-sm" style={{ color: "hsl(240 15% 93%)" }}>{t.name}</span>
                  </div>
                  {t.description && (
                    <p className="text-xs" style={{ color: "hsl(240 8% 56%)" }}>{t.description}</p>
                  )}
                  {t.flow?.steps?.length > 0 && (
                    <p className="text-[10px] mt-2 font-mono" style={{ color: "hsl(240 8% 42%)" }}>
                      {t.flow.steps.length} step{t.flow.steps.length !== 1 ? "s" : ""}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
