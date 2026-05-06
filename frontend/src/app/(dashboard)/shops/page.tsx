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

  // Sempre lê wsId no momento da request — antes a constante `headers`
  // era capturada no closure do mutationFn e, se o usuário abrisse a
  // página antes do WorkspaceContext resolver, headers ficava undefined
  // (currentWorkspace null). Resultado: POST /v1/shops sem header
  // X-Workspace-ID → backend respondia "X-Workspace-ID é obrigatório".
  const buildHeaders = () => {
    const id = currentWorkspace?.id;
    return id ? { "X-Workspace-ID": id } : undefined;
  };
  const headers = buildHeaders(); // pra requests no render path (GET list)

  const { data: shopsRes, isLoading } = useQuery<{ data: Shop[] }>({
    queryKey: ["shops", wsId],
    queryFn: () => api.get("/v1/shops", { headers }).then((r) => r.data),
    enabled: !!wsId,
  });
  const shops = shopsRes?.data ?? [];

  const createMut = useMutation({
    mutationFn: (data: typeof form) => {
      const h = buildHeaders();
      if (!h) {
        throw new Error("Workspace ainda carregando — tente novamente em instantes.");
      }
      return api.post("/v1/shops", data, { headers: h });
    },
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
        (e as Error)?.message ||
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
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-1)" }}>
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
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
          style={{
            background: "linear-gradient(135deg, rgba(0,212,106,0.20) 0%, rgba(0,212,106,0.10) 100%)",
            backdropFilter: "blur(12px) saturate(180%)",
            WebkitBackdropFilter: "blur(12px) saturate(180%)",
            border: "1px solid rgba(0,212,106,0.25)",
            color: "var(--green)",
            transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(0,212,106,0.30) 0%, rgba(0,212,106,0.18) 100%)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(0,212,106,0.20) 0%, rgba(0,212,106,0.10) 100%)"; }}
        >
          <Plus className="w-4 h-4" /> Nova shop
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-10" style={{ color: "var(--text-3)" }}>
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </div>
      ) : shops.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          {/* SVG: sacola de compras geométrica */}
          <div className="mb-6 opacity-60">
            <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
              {/* Corpo da sacola */}
              <rect x="22" y="44" width="76" height="58" rx="8" stroke="var(--text-3)" strokeWidth="2.5" fill="none" />
              {/* Alças */}
              <path d="M44 44 C44 30 76 30 76 44" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
              {/* Detalhe central — ícone de loja */}
              <line x1="38" y1="68" x2="82" y2="68" stroke="var(--text-3)" strokeWidth="1.5" strokeDasharray="4 3" />
              {/* Etiqueta de preço */}
              <rect x="50" y="76" width="20" height="14" rx="3" stroke="var(--green)" strokeWidth="1.5" fill="none" opacity="0.8" />
              <line x1="60" y1="74" x2="60" y2="76" stroke="var(--green)" strokeWidth="1.5" />
              {/* Estrelinhas decorativas */}
              <circle cx="35" cy="56" r="2" fill="var(--text-3)" opacity="0.5" />
              <circle cx="85" cy="56" r="2" fill="var(--text-3)" opacity="0.5" />
            </svg>
          </div>
          <h3 className="text-base font-semibold mb-2" style={{ color: "var(--text-1)" }}>
            Nenhuma loja criada
          </h3>
          <p className="text-sm mb-6 max-w-xs" style={{ color: "var(--text-3)" }}>
            Crie uma loja para vender produtos pelo WhatsApp
          </p>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: "var(--green-dim)", color: "var(--green)", border: "1px solid var(--green-border)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,212,106,0.18)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--green-dim)"; }}
          >
            <Plus className="w-4 h-4" />
            Criar loja
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {shops.map((shop) => (
            <Link
              key={shop.id}
              href={`/shops/${shop.id}`}
              className="rounded-xl p-4 block relative"
              style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: "20px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
                transition: "all 0.35s cubic-bezier(0.16,1,0.3,1)",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.16)";
                (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.10)";
                (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
              }}
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
                  <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>
                    {shop.name}
                  </p>
                  <p className="text-xs truncate" style={{ color: "var(--text-3)" }}>
                    {shop.slug} · {shop.currency}
                  </p>
                  <span
                    className="inline-block text-[10px] mt-1 px-2 py-0.5"
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: "10px",
                      color: "var(--text-4)",
                      transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
                    }}
                  >
                    {shop.visibility === "public"
                      ? "🌐 Pública"
                      : shop.visibility === "link_only"
                        ? "🔗 Link-only"
                        : "🔒 Privada"}
                  </span>
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
            className="inline-flex items-center gap-1 text-xs font-medium"
            style={{ color: "#8b5cf6" }}
          >
            Ver integrações disponíveis <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {creating && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          style={{ background: "var(--surface-overlay)" }}
          onClick={() => setCreating(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6 relative"
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: "20px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.10)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              position: "absolute", top: 0, left: "15%", right: "15%", height: "1px",
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)",
              pointerEvents: "none",
            }} />
            <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--text-1)" }}>
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
                    background: "rgba(255,255,255,0.05)",
                    backdropFilter: "blur(8px)",
                    color: "var(--text-1)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
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
                    background: "rgba(255,255,255,0.05)",
                    backdropFilter: "blur(8px)",
                    color: "var(--text-1)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
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
                    background: "rgba(255,255,255,0.05)",
                    backdropFilter: "blur(8px)",
                    color: "var(--text-1)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
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
                style={{
                  background: "rgba(255,255,255,0.05)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.09)",
                  color: "var(--text-2)",
                  transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.09)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
              >
                Cancelar
              </button>
              <button
                onClick={() => createMut.mutate(form)}
                disabled={!form.name.trim() || createMut.isPending}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg, rgba(0,212,106,0.25) 0%, rgba(0,212,106,0.12) 100%)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid rgba(0,212,106,0.30)",
                  color: "var(--green)",
                  transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
                }}
                onMouseEnter={e => { if (!createMut.isPending) (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(0,212,106,0.38) 0%, rgba(0,212,106,0.20) 100%)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(0,212,106,0.25) 0%, rgba(0,212,106,0.12) 100%)"; }}
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
