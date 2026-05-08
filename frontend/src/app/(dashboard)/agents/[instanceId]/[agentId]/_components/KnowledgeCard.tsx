"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, FileText, Plus, Trash2, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { integrationsApi } from "@/lib/api";
import { CollapsibleCard } from "../../../_shared/CollapsibleCard";
import { uid, type AgentForm } from "../../../_shared/types";

type Props = {
  form: AgentForm;
  update: (updater: (prev: AgentForm) => AgentForm) => void;
  instanceId: string;
};

// Card de Conhecimento — texto livre + FAQ estruturado + uploads de
// documentos (PDF/DOC/MD/TXT). Os 3 alimentam o RAG quando habilitado.
// Uploads e deletes são mutations diretas (não passam pelo save geral)
// porque o backend já persiste o asset na hora.
export function KnowledgeCard({ form, update, instanceId }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      await integrationsApi.uploadAgentAsset(instanceId, file, "knowledge");
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["instance-agent", instanceId] });
      toast.success("Arquivo adicionado à base.");
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Não foi possível subir o arquivo."),
  });

  const deleteMut = useMutation({
    mutationFn: (assetId: string) => integrationsApi.deleteAgentAsset(instanceId, assetId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["instance-agent", instanceId] });
      toast.success("Arquivo removido.");
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Não foi possível remover."),
  });

  const knowledgeAssets = form.assets.filter((a) => a.category === "knowledge");

  return (
    <CollapsibleCard
      title="Conhecimento"
      icon={Brain}
      accentColor="#60a5fa"
      meta={
        <>
          {form.faq.length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
              background: "rgba(96,165,250,0.10)", color: "#60a5fa",
              border: "1px solid rgba(96,165,250,0.20)",
            }}>
              {form.faq.length} FAQ
            </span>
          )}
          {knowledgeAssets.length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
              background: "rgba(96,165,250,0.10)", color: "#60a5fa",
              border: "1px solid rgba(96,165,250,0.20)",
            }}>
              {knowledgeAssets.length} doc
            </span>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={form.rag_enabled}
              onChange={(e) => update((p) => ({ ...p, rag_enabled: e.target.checked }))}
              className="accent-blue-500"
            />
            <span style={{ color: "var(--text-3)" }}>RAG</span>
          </label>
        </>
      }
    >
      <div className="space-y-4 pt-3">
        {/* Texto livre */}
        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-2)" }}>
            Base de conhecimento (texto livre)
          </label>
          <textarea
            value={form.knowledge_base}
            onChange={(e) => update((p) => ({ ...p, knowledge_base: e.target.value }))}
            placeholder="Serviços, políticas, preços, processos, objeções, scripts..."
            style={{ ...inputStyle, minHeight: 120, resize: "vertical" }}
          />
          <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>
            Use pra resumir o essencial. Pra documentos longos, prefira upload abaixo.
          </p>
        </div>

        {/* FAQ */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] font-medium" style={{ color: "var(--text-2)" }}>
              Perguntas frequentes
            </label>
            <button
              type="button"
              onClick={() =>
                update((p) => ({
                  ...p,
                  faq: [...p.faq, { id: uid(), question: "", answer: "" }],
                }))
              }
              className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md"
              style={{
                background: "rgba(96,165,250,0.10)",
                border: "1px solid rgba(96,165,250,0.20)",
                color: "#60a5fa",
              }}
            >
              <Plus className="w-3 h-3" />
              Adicionar
            </button>
          </div>
          {form.faq.length === 0 ? (
            <p className="text-[10px] py-2" style={{ color: "var(--text-4)" }}>
              Nenhuma pergunta cadastrada.
            </p>
          ) : (
            <div className="space-y-2">
              {form.faq.map((item, idx) => (
                <div
                  key={item.id}
                  className="rounded-lg p-2.5 space-y-1.5"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--surface-border)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono" style={{ color: "var(--text-4)" }}>
                      #{idx + 1}
                    </span>
                    <input
                      type="text"
                      value={item.question}
                      onChange={(e) =>
                        update((p) => ({
                          ...p,
                          faq: p.faq.map((f) =>
                            f.id === item.id ? { ...f, question: e.target.value } : f,
                          ),
                        }))
                      }
                      placeholder="Pergunta…"
                      style={{ ...inputStyle, padding: "6px 10px", fontSize: 12 }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        update((p) => ({
                          ...p,
                          faq: p.faq.filter((f) => f.id !== item.id),
                        }))
                      }
                      className="p-1 rounded hover:bg-red-500/10"
                      style={{ color: "var(--text-4)" }}
                      title="Remover"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <textarea
                    value={item.answer}
                    onChange={(e) =>
                      update((p) => ({
                        ...p,
                        faq: p.faq.map((f) =>
                          f.id === item.id ? { ...f, answer: e.target.value } : f,
                        ),
                      }))
                    }
                    placeholder="Resposta…"
                    style={{
                      ...inputStyle,
                      padding: "6px 10px",
                      fontSize: 12,
                      minHeight: 50,
                      resize: "vertical",
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Uploads */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] font-medium" style={{ color: "var(--text-2)" }}>
              Documentos
            </label>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".pdf,.doc,.docx,.txt,.md,.pptx,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMut.mutate(file);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadMut.isPending}
              className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md disabled:opacity-50"
              style={{
                background: "rgba(96,165,250,0.10)",
                border: "1px solid rgba(96,165,250,0.20)",
                color: "#60a5fa",
              }}
            >
              {uploadMut.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Upload className="w-3 h-3" />
              )}
              Subir arquivo
            </button>
          </div>
          {knowledgeAssets.length === 0 ? (
            <p className="text-[10px] py-2" style={{ color: "var(--text-4)" }}>
              PDF, DOC, MD, TXT, PPTX ou JSON. Texto extraído alimenta o RAG.
            </p>
          ) : (
            <div className="space-y-1.5">
              {knowledgeAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--surface-border)",
                  }}
                >
                  <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#60a5fa" }} />
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-xs font-medium truncate"
                      style={{ color: "var(--text-1)" }}
                      title={asset.file_name}
                    >
                      {asset.name || asset.file_name}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--text-4)" }}>
                      {fmtBytes(asset.size_bytes)}
                      {asset.extracted_text ? ` · ${asset.extracted_text.length.toLocaleString()} chars indexados` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteMut.mutate(asset.id)}
                    disabled={deleteMut.isPending}
                    className="p-1 rounded hover:bg-red-500/10 disabled:opacity-50"
                    style={{ color: "var(--text-4)" }}
                    title="Remover"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--surface-2)",
  border: "1px solid var(--surface-border)",
  borderRadius: 10,
  color: "var(--text-1)",
  fontSize: 13,
  outline: "none",
};
