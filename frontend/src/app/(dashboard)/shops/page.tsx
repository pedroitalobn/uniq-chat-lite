"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingBag, Plus, Loader2, Store, Package, ArrowRight } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import api from "@/lib/api";

interface Shop {
  id: string;
  name: string;
  slug: string;
  description?: string;
  currency: string;
  logo_url?: string;
  visibility: "private" | "link_only" | "public";
  is_active: boolean;
  created_at: string;
}

export default function ShopsPage() {
  const qc = useQueryClient();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", currency: "BRL" });

  const headers = wsId ? { "X-Workspace-ID": wsId } : undefined;

  const { data: shopsRes, isLoading } = useQuery<{ data: Shop[] }>({
    queryKey: ["shops", wsId],
    queryFn: () => api.get("/v1/shops", { headers }).then((r) => r.data),
    enabled: !!wsId,
  });
  const shops = shopsRes?.data ?? [];

  const createMut = useMutation({
    mutationFn: (data: typeof form) => api.post("/v1/shops", data, { headers }),
    onSuccess: () => {
      toast.success("Shop criada!");
      setCreating(false);
      setForm({ name: "", description: "", currency: "BRL" });
      qc.invalidateQueries({ queryKey: ["shops"] });
    },
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.message ||
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Erro ao criar";
      toast.error(msg);
    },
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 lg:py-8">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShoppingBag className="w-5 h-5" style={{ color: "var(--green)" }} />
            <h1 className="text-xl font-bold" style={{ color: "var(--text-1)" }}>
              Shops
            </h1>
          </div>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>
            Lojas atreladas às suas instâncias. Conecte e-commerces externos pra sincronizar produtos
            e usar em journeys, agentes e campanhas.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap"
          style={{ background: "var(--green)", color: "var(--green-fg)" }}
        >
          <Plus className="w-4 h-4" /> Nova shop
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-10" style={{ color: "var(--text-3)" }}>
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </div>
      ) : shops.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed py-12 flex flex-col items-center gap-3"
          style={{ borderColor: "var(--surface-border)" }}
        >
          <Store className="w-10 h-10 opacity-40" style={{ color: "var(--text-3)" }} />
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            Nenhuma shop criada ainda
          </p>
          <p className="text-xs max-w-md text-center" style={{ color: "var(--text-3)" }}>
            Crie a primeira pra começar a vender pelo WhatsApp. Você pode subir produtos manualmente
            (consultorias, infoprodutos, serviços) ou conectar e-commerces como Shopify, VTEX,
            Mercado Livre, Magalu e Amazon.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {shops.map((shop) => (
            <Link
              key={shop.id}
              href={`/shops/${shop.id}`}
              className="rounded-xl p-4 transition-colors hover:bg-white/5"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "var(--surface-3)" }}
                >
                  {shop.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={shop.logo_url} alt={shop.name} className="w-full h-full rounded-lg object-cover" />
                  ) : (
                    <Store className="w-5 h-5" style={{ color: "var(--text-3)" }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>
                    {shop.name}
                  </p>
                  <p className="text-xs truncate" style={{ color: "var(--text-3)" }}>
                    {shop.slug} · {shop.currency}
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>
                    {shop.visibility === "public"
                      ? "🌐 Pública"
                      : shop.visibility === "link_only"
                        ? "🔗 Link-only"
                        : "🔒 Privada"}
                  </p>
                </div>
                <ArrowRight className="w-4 h-4" style={{ color: "var(--text-3)" }} />
              </div>
            </Link>
          ))}
        </div>
      )}

      <div
        className="mt-8 rounded-2xl p-4 flex items-start gap-3"
        style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)" }}
      >
        <Package className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "#8b5cf6" }} />
        <div className="flex-1">
          <p className="text-sm font-medium mb-0.5" style={{ color: "var(--text-1)" }}>
            Vai conectar uma plataforma de e-commerce?
          </p>
          <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>
            Suportamos Shopify, VTEX, Mercado Livre, Magalu, Amazon, Shopee, WooCommerce, BigCommerce
            e WhatsApp Catalog. Veja a aba Shop em Integrações pra conectar.
          </p>
          <Link
            href="/integrations?section=shop"
            className="inline-flex items-center gap-1 text-xs font-semibold"
            style={{ color: "#8b5cf6" }}
          >
            Ver integrações disponíveis <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {creating && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "var(--surface-overlay)" }}
          onClick={() => setCreating(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4" style={{ color: "var(--text-1)" }}>
              Nova shop
            </h3>
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>
                  Nome *
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Minha loja"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{
                    background: "var(--surface-3)",
                    color: "var(--text-1)",
                    border: "1px solid var(--surface-border)",
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>
                  Descrição
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                  style={{
                    background: "var(--surface-3)",
                    color: "var(--text-1)",
                    border: "1px solid var(--surface-border)",
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>
                  Moeda
                </label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{
                    background: "var(--surface-3)",
                    color: "var(--text-1)",
                    border: "1px solid var(--surface-border)",
                  }}
                >
                  <option value="BRL">BRL — Real</option>
                  <option value="USD">USD — Dólar</option>
                  <option value="EUR">EUR — Euro</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCreating(false)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium"
                style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
              >
                Cancelar
              </button>
              <button
                onClick={() => createMut.mutate(form)}
                disabled={!form.name.trim() || createMut.isPending}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center disabled:opacity-50"
                style={{ background: "var(--green)", color: "var(--green-fg)" }}
              >
                {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
