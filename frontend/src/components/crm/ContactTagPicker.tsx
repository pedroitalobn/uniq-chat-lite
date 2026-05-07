"use client";

// ContactTagPicker — UI consistente pra atribuir/remover tags de um
// contato. Mostra tags ativas (chips coloridos com X pra remover)
// + botão "+" que abre dropdown com tags do workspace pra atribuir.
// Permite criar tag nova no fly. Backend: PUT /v1/crm/contacts/:id/tags
// com array completo de tag_ids (replace, não diff).
//
// Pode ser embebido em qualquer página de detalhe de contato.

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Tag as TagIcon, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { crmApi } from "@/lib/api";

type Tag = { id: string; name: string; color: string };

const PRESET_COLORS = ["#00d46a", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export function ContactTagPicker({
  contactId,
  workspaceId,
  currentTags,
  onChange,
}: {
  contactId: string;
  workspaceId?: string;
  currentTags: Tag[];
  onChange?: (tags: Tag[]) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0] || "#00d46a");
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Click outside fecha o dropdown.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const tagsQuery = useQuery<Tag[]>({
    queryKey: ["crm-tags", workspaceId],
    queryFn: () => crmApi.listTags(workspaceId).then((r) => r.data),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
  const allTags = tagsQuery.data ?? [];
  const currentIds = new Set(currentTags.map((t) => t.id));

  const assignMut = useMutation({
    mutationFn: (tagIds: string[]) => crmApi.assignTags(contactId, tagIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact", contactId] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: () => toast.error("Erro ao atualizar tags"),
  });

  const createMut = useMutation({
    mutationFn: () => crmApi.createTag(newName.trim(), newColor, workspaceId),
    onSuccess: (res) => {
      const newTag = res.data as Tag;
      qc.invalidateQueries({ queryKey: ["crm-tags", workspaceId] });
      // já atribui ao contato
      const next = [...currentTags, newTag];
      assignMut.mutate(next.map((t) => t.id));
      onChange?.(next);
      setNewName("");
      setCreating(false);
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e?.response?.data?.error || "Erro ao criar tag"),
  });

  const toggleTag = (tag: Tag) => {
    const has = currentIds.has(tag.id);
    const next = has ? currentTags.filter((t) => t.id !== tag.id) : [...currentTags, tag];
    assignMut.mutate(next.map((t) => t.id));
    onChange?.(next);
  };

  const removeTag = (tagId: string) => {
    const next = currentTags.filter((t) => t.id !== tagId);
    assignMut.mutate(next.map((t) => t.id));
    onChange?.(next);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap gap-1.5 items-center">
        {currentTags.map((t) => (
          <span key={t.id}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ background: t.color + "22", color: t.color, border: `1px solid ${t.color}44` }}>
            <TagIcon className="w-2.5 h-2.5" />
            {t.name}
            <button onClick={() => removeTag(t.id)} className="ml-0.5 opacity-60 hover:opacity-100" title="Remover">
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <button onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all"
          style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)", color: "var(--text-3)" }}>
          {assignMut.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Plus className="w-2.5 h-2.5" />}
          Tag
        </button>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 left-0 w-64 rounded-xl shadow-2xl overflow-hidden"
          style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
          {!creating && (
            <>
              <div className="px-3 py-2 text-[10px] uppercase tracking-wider font-medium"
                style={{ color: "var(--text-3)", borderBottom: "1px solid var(--surface-border)" }}>
                Atribuir tags
              </div>
              <div className="max-h-56 overflow-y-auto">
                {allTags.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-center" style={{ color: "var(--text-3)" }}>
                    Nenhuma tag criada ainda.
                  </p>
                ) : (
                  allTags.map((t) => {
                    const active = currentIds.has(t.id);
                    return (
                      <button key={t.id} onClick={() => toggleTag(t)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/[0.03]"
                        style={{ color: "var(--text-2)" }}>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
                        <span className="flex-1 text-left">{t.name}</span>
                        {active && <Check className="w-3 h-3" style={{ color: "var(--green)" }} />}
                      </button>
                    );
                  })
                )}
              </div>
              <button onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-white/[0.03]"
                style={{ color: "var(--green)", borderTop: "1px solid var(--surface-border)" }}>
                <Plus className="w-3 h-3" /> Criar nova tag
              </button>
            </>
          )}

          {creating && (
            <div className="p-3 space-y-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome da tag"
                autoFocus
                className="w-full px-2 py-1.5 rounded-lg text-xs outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }} />
              <div className="flex gap-1 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewColor(c)}
                    className="w-5 h-5 rounded-full"
                    style={{ background: c, boxShadow: c === newColor ? `0 0 0 2px var(--surface-1), 0 0 0 4px ${c}` : "none" }} />
                ))}
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setCreating(false); setNewName(""); }}
                  className="flex-1 px-2 py-1.5 rounded-lg text-xs" style={{ color: "var(--text-3)" }}>
                  Cancelar
                </button>
                <button onClick={() => createMut.mutate()} disabled={!newName.trim() || createMut.isPending}
                  className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                  style={{ background: "var(--green)", color: "#03170a" }}>
                  {createMut.isPending ? "Criando..." : "Criar e atribuir"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
