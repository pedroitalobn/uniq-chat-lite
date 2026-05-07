"use client";

// EntityCustomFieldsSection — bloco compacto pra mostrar / editar
// custom_fields em páginas de detalhe (Deal/Contact/Company). Carrega
// as defs do workspace, exibe os campos com renderer dinâmico e tem
// botão "Salvar" só quando há mudança vs. o valor inicial.
//
// Recebe um patch fn pra desacoplar do API client (cada entidade tem
// rota PATCH própria).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, Loader2, SlidersHorizontal } from "lucide-react";
import { customFieldsApi, type CustomFieldDef, type CustomFieldEntity } from "@/lib/api";
import { CustomFieldsRenderer, type CustomFieldsValue } from "./CustomFieldsRenderer";

export function EntityCustomFieldsSection({
  workspaceId,
  entityType,
  entityId,
  initialValue,
  onPatch,
  invalidateKeys,
}: {
  workspaceId: string;
  entityType: CustomFieldEntity;
  entityId: string;
  initialValue: CustomFieldsValue | string | null | undefined;
  // Caller fornece como gravar — ex: dealsApi.patch / crmApi.updateContact / companiesApi.patch
  onPatch: (custom_fields: CustomFieldsValue) => Promise<unknown>;
  // Keys do React Query que devem ser invalidadas após salvar.
  invalidateKeys?: Array<unknown[]>;
}) {
  const qc = useQueryClient();

  const defsQ = useQuery({
    queryKey: ["custom-fields", workspaceId, entityType],
    queryFn: () => customFieldsApi.list(workspaceId, entityType).then((r) => r.data.items ?? []),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  // initialValue pode chegar como string JSON (vindo do backend) ou como
  // objeto já parseado. Normaliza.
  const parsedInitial = useMemo<CustomFieldsValue>(() => {
    if (!initialValue) return {};
    if (typeof initialValue === "string") {
      try { return JSON.parse(initialValue) || {}; } catch { return {}; }
    }
    return initialValue;
  }, [initialValue]);

  const [value, setValue] = useState<CustomFieldsValue>(parsedInitial);

  // Quando initialValue muda (refetch após save), sincroniza a UI.
  useEffect(() => {
    setValue(parsedInitial);
  }, [parsedInitial]);

  const dirty = useMemo(() => JSON.stringify(value) !== JSON.stringify(parsedInitial), [value, parsedInitial]);

  const saveMut = useMutation({
    mutationFn: () => onPatch(value),
    onSuccess: () => {
      toast.success("Campos atualizados");
      (invalidateKeys ?? []).forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao salvar";
      toast.error(msg);
    },
  });

  const defs: CustomFieldDef[] = defsQ.data ?? [];
  if (defsQ.isLoading) return null;
  if (defs.length === 0) return null;

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
            Campos personalizados
          </p>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-medium disabled:opacity-50"
            style={{ background: "var(--green)", color: "#03170a" }}
          >
            {saveMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Salvar
          </button>
        )}
      </div>
      <CustomFieldsRenderer defs={defs} value={value} onChange={setValue} compact />
      <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
        Definidos em <a href="/crm/properties" className="underline" style={{ color: "var(--text-2)" }}>Propriedades</a>.
      </p>
    </div>
  );
}
