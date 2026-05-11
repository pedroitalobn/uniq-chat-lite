"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { integrationsApi } from "@/lib/api";
import { type AgentForm, emptyForm, mapAgent } from "./types";

// Hook compartilhado pelo Studio + Settings — concentra fetch do agente,
// state local do form, save e toggle de ativação. AgentId="primary" é
// id especial que omite o param no GET (vai pro agente primário da
// instância). Mantém o mesmo queryKey usado pelo editor antigo
// (["instance-agent", instance, agent]) pra que mudanças aqui apareçam
// automaticamente lá e vice-versa enquanto coexistirem.
export function useAgentForm(instanceId: string | undefined, agentId: string | undefined) {
  const qc = useQueryClient();
  const [form, setForm] = useState<AgentForm>(emptyForm());
  const [dirty, setDirty] = useState(false);

  const isPrimary = agentId === "primary" || !agentId;
  const realAgentId = isPrimary ? "" : agentId!;

  const agentQuery = useQuery({
    queryKey: ["instance-agent", instanceId ?? "", realAgentId],
    queryFn: async () =>
      (await integrationsApi.getAgent(instanceId!, realAgentId || undefined)).data,
    enabled: !!instanceId,
  });

  // Hidrata o form sempre que vem dado novo do server. Reset do dirty
  // junto — após carregar do server o form bate com o backend.
  useEffect(() => {
    if (agentQuery.data) {
      setForm(mapAgent(agentQuery.data));
      setDirty(false);
    } else if (instanceId) {
      setForm(emptyForm());
      setDirty(false);
    }
  }, [agentQuery.data, instanceId]);

  // Wrapper do setForm que marca o form como dirty pra avisar usuário
  // sobre mudanças não salvas. setForm direto (do useState) também é
  // exposto pra casos onde queremos hidratar sem marcar dirty.
  const updateForm = (updater: (prev: AgentForm) => AgentForm) => {
    setForm((p) => {
      const next = updater(p);
      return next;
    });
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!instanceId) throw new Error("instância ausente");
      await integrationsApi.updateAgent(
        instanceId,
        {
          integration_id: form.integration_id || null,
          model: form.model,
          system_prompt: form.system_prompt,
          agent_name: form.agent_name,
          identity: form.identity,
          objective: form.objective,
          communication_guidelines: form.communication_guidelines,
          service_instructions: form.service_instructions,
          restrictions: form.restrictions,
          knowledge_base: form.knowledge_base,
          faq: form.faq,
          variables: form.variables,
          voice: form.voice,
          skills: form.skills,
          app_access: form.app_access,
          rag_enabled: form.rag_enabled,
          is_active: form.is_active,
          webhook_url: form.webhook_url,
          webhook_secret: form.webhook_secret,
          mcp_server_url: form.mcp_server_url,
          role: form.role,
          handoff_skills: form.handoff_skills,
          action_confirmation: form.action_confirmation,
          activation_mode: form.activation_mode,
          schedule: form.schedule,
          trigger_mode: form.trigger_mode,
          trigger_keywords: form.trigger_keywords,
          trigger_message_types: form.trigger_message_types,
          trigger_webhook_secret: form.trigger_webhook_secret,
          response_pace: form.response_pace,
          response_length: form.response_length,
          access_restricted: form.access_restricted,
          editor_role_ids: form.editor_role_ids,
        } as any,
        realAgentId || undefined,
      );
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["instance-agent", instanceId, realAgentId] });
      await qc.invalidateQueries({ queryKey: ["instance-agents", instanceId] });
      setDirty(false);
      toast.success("Agente salvo.");
    },
    onError: (error: any) => {
      const data = error?.response?.data;
      const msg = data?.error || "Não foi possível salvar.";
      const hint = data?.hint || data?.detail;
      toast.error(hint ? `${msg} — ${hint}` : msg);
    },
  });

  // Toggle independente do save geral — PATCH só de is_active. Mantém
  // edições não-salvas no form intactas.
  const toggleActiveMutation = useMutation({
    mutationFn: async (active: boolean) => {
      if (!instanceId) throw new Error("instância ausente");
      await integrationsApi.updateAgent(instanceId, { is_active: active }, realAgentId || undefined);
      return active;
    },
    onSuccess: async (active) => {
      setForm((p) => ({ ...p, is_active: active }));
      await qc.invalidateQueries({ queryKey: ["instance-agent", instanceId, realAgentId] });
      await qc.invalidateQueries({ queryKey: ["instance-agents", instanceId] });
      toast.success(active ? "Agente ativado." : "Agente desativado.");
    },
    onError: (error: any) =>
      toast.error(error?.response?.data?.error || "Não foi possível alterar o status."),
  });

  return {
    form,
    setForm,
    updateForm,
    dirty,
    isLoading: agentQuery.isLoading,
    error: agentQuery.error,
    refetch: agentQuery.refetch,
    save: saveMutation.mutate,
    isSaving: saveMutation.isPending,
    toggleActive: toggleActiveMutation.mutate,
    isToggling: toggleActiveMutation.isPending,
  };
}
