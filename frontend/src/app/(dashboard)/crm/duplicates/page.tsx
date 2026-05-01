"use client";

// Duplicate Resolution — encontra contatos com mesmo phone/email e
// permite merge num único record. Inspirado em Customer.io identity
// resolution + Close bulk merge.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, GitMerge, AlertCircle, Users, Phone, Mail } from "lucide-react";
import { toast } from "sonner";
import { contactsMergeApi } from "@/lib/api";

interface DupGroup {
  key: string;
  count: number;
  ids: string;
}

export default function DuplicatesPage() {
  const qc = useQueryClient();
  const [by, setBy] = useState<"phone" | "email">("phone");

  const { data, isLoading } = useQuery<{ groups: DupGroup[] }>({
    queryKey: ["duplicates", by],
    queryFn: () => contactsMergeApi.duplicates(by).then((r) => r.data),
  });
  const groups = data?.groups || [];

  const mergeMut = useMutation({
    mutationFn: ({ survivor, loosers }: { survivor: string; loosers: string[] }) =>
      contactsMergeApi.merge(survivor, loosers),
    onSuccess: () => {
      toast.success("Contatos fundidos");
      qc.invalidateQueries({ queryKey: ["duplicates"] });
    },
    onError: () => toast.error("Erro ao fundir"),
  });

  return (
    <div className="px-4 sm:px-6 py-6 lg:py-8 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-medium" style={{ color: "var(--text-1)" }}>Identity Resolution</h1>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Contatos duplicados (mesmo número WhatsApp + IG + email) viram um único record.
            Merge re-aponta conversas, deals, orders e tags pro contato sobrevivente.
          </p>
        </div>

      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "var(--text-3)" }}>Buscar duplicatas por:</span>
        <div className="inline-flex rounded-lg overflow-hidden" style={{ background: "var(--surface-3)" }}>
          {(["phone", "email"] as const).map((opt) => (
            <button key={opt} onClick={() => setBy(opt)}
              className="px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5"
              style={by === opt
                ? { background: "var(--green-soft)", color: "var(--green)" }
                : { color: "var(--text-3)" }}>
              {opt === "phone" ? <Phone className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
              {opt === "phone" ? "Telefone" : "Email"}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 rounded-2xl"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <Users className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--text-3)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Nenhuma duplicata por {by === "phone" ? "telefone" : "email"}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Sua base está limpa — nenhum contato compartilha o mesmo {by}.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const ids = g.ids.split(",");
            const [survivor, ...loosers] = ids;
            return (
              <div key={g.key}
                className="rounded-2xl p-4"
                style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
                      <code className="font-mono">{g.key}</code>
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
                      {g.count} contatos · primeiro será o sobrevivente
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`Fundir ${g.count} contatos com ${by} ${g.key}?`)) {
                        mergeMut.mutate({ survivor, loosers });
                      }
                    }}
                    disabled={mergeMut.isPending}
                    className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
                    style={{ background: "var(--green)", color: "var(--green-fg)" }}>
                    {mergeMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                    Fundir
                  </button>
                </div>
                <div className="text-[10px] font-mono mt-2" style={{ color: "var(--text-4)" }}>
                  {ids.slice(0, 3).join(" · ")}{ids.length > 3 ? ` … +${ids.length - 3}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-xl p-3 flex items-start gap-2"
        style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.18)" }}>
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#60a5fa" }} />
        <p className="text-xs" style={{ color: "var(--text-2)" }}>
          O <strong>primeiro contato</strong> de cada grupo é o sobrevivente. Os demais são deletados após
          re-apontar conversations/orders/deals/tags. Phone e email dos deletados viram aliases pra busca.
        </p>
      </div>
    </div>
  );
}
