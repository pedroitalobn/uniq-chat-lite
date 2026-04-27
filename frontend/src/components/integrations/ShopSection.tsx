"use client";

import { useQuery } from "@tanstack/react-query";
import { ShoppingBag, ExternalLink, Loader2, MapPin, CheckCircle2, Store, Plus } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

interface Provider {
  id: string;
  name: string;
  region: string;
  description: string;
  status: "ready" | "coming_soon";
}

interface Shop {
  id: string;
  name: string;
  slug: string;
}

interface Integration {
  id: string;
  shop_id: string;
  provider: string;
  name: string;
  is_active: boolean;
  last_sync_at?: string;
  last_sync_status?: string;
  synced_count: number;
}

const REGION_COLORS: Record<string, string> = {
  "BR / LATAM":     "#22c55e",
  "BR Enterprise":  "#22c55e",
  "BR":             "#22c55e",
  "BR / SEA":       "#f59e0b",
  "EUA / Global":   "#3b82f6",
  "EUA / Global ":  "#3b82f6",
  "Global":         "#8b5cf6",
};

export function ShopSection() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const headers = wsId ? { "X-Workspace-ID": wsId } : undefined;

  const { data: providers = [], isLoading } = useQuery<Provider[]>({
    queryKey: ["shop-providers"],
    queryFn: () => api.get("/v1/shop/providers").then(r => r.data),
  });

  const { data: shopsData } = useQuery<{ data: Shop[] }>({
    queryKey: ["shops", wsId],
    queryFn: () => api.get("/v1/shops", { headers }).then(r => r.data),
    enabled: !!wsId,
  });
  const shops = shopsData?.data ?? [];

  // Integrações de TODAS as shops do workspace (concatena).
  const { data: integrationsByShop = {} } = useQuery<Record<string, Integration[]>>({
    queryKey: ["shop-integrations-all", wsId, shops.map(s => s.id).join(",")],
    queryFn: async () => {
      const map: Record<string, Integration[]> = {};
      await Promise.all(
        shops.map(async (s) => {
          try {
            const r = await api.get(`/v1/shops/${s.id}/integrations`, { headers });
            map[s.id] = r.data?.data ?? [];
          } catch {
            map[s.id] = [];
          }
        })
      );
      return map;
    },
    enabled: !!wsId && shops.length > 0,
  });

  const allIntegrations: (Integration & { shop?: Shop })[] = shops.flatMap((s) =>
    (integrationsByShop[s.id] ?? []).map((i) => ({ ...i, shop: s }))
  );

  // Agrupar por região: BR primeiro, depois EUA, depois Global.
  const grouped = (() => {
    const order = ["BR / LATAM", "BR Enterprise", "BR", "BR / SEA", "EUA / Global", "Global"];
    const out: Record<string, Provider[]> = {};
    for (const p of providers) {
      out[p.region] = out[p.region] || [];
      out[p.region].push(p);
    }
    return order
      .filter((r) => out[r]?.length)
      .map((r) => [r, out[r]] as const);
  })();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <ShoppingBag className="w-4 h-4" style={{ color: "var(--green)" }} />
          <h2 className="text-base font-medium" style={{ color: "var(--text-1)" }}>
            Integrações de Shop
          </h2>
        </div>
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          Conecte seu catálogo a plataformas de e-commerce (Shopify, Mercado Livre, VTEX, Magalu, Amazon...).
          Produtos sincronizam automaticamente. Use em campanhas, journeys e agentes IA.
        </p>
      </div>

      {shops.length === 0 ? (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: "var(--green-soft)", border: "1px solid var(--green-border)" }}
        >
          <ShoppingBag className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "var(--green)" }} />
          <div className="flex-1">
            <p className="text-sm font-medium mb-0.5" style={{ color: "var(--text-1)" }}>
              Crie uma loja primeiro
            </p>
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              Cada integração precisa estar atrelada a uma Shop.
            </p>
          </div>
          <Link
            href="/shops"
            className="text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}
          >
            Ir pra Shops
          </Link>
        </div>
      ) : allIntegrations.length === 0 ? (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
        >
          <Store className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "var(--text-3)" }} />
          <div className="flex-1">
            <p className="text-sm font-medium mb-0.5" style={{ color: "var(--text-1)" }}>
              Nenhuma integração ativa
            </p>
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              Você tem {shops.length} loja{shops.length > 1 ? "s" : ""}. Conecte uma das plataformas abaixo pra começar a sincronizar produtos.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-2)" }}>
              Integrações ativas <span className="ml-1 normal-case font-normal" style={{ color: "var(--text-3)" }}>({allIntegrations.length})</span>
            </p>
            <Link
              href="/shops"
              className="text-[11px] inline-flex items-center gap-1"
              style={{ color: "var(--green)" }}
            >
              Gerenciar shops <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {allIntegrations.map((it) => (
              <ActiveIntegrationCard key={it.id} integration={it} />
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8" style={{ color: "var(--text-3)" }}>
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([region, list]) => (
            <div key={region}>
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-3.5 h-3.5" style={{ color: REGION_COLORS[region] || "var(--text-3)" }} />
                <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-2)" }}>
                  {region}
                </h3>
                <span className="text-[10px] tabular-nums" style={{ color: "var(--text-4)" }}>
                  {list.length}
                </span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {list.map((p) => (
                  <ProviderCard key={p.id} provider={p} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveIntegrationCard({ integration }: { integration: Integration & { shop?: Shop } }) {
  const ok = integration.last_sync_status === "ok" || integration.last_sync_status === "success";
  const lastSync = integration.last_sync_at
    ? new Date(integration.last_sync_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "nunca";
  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-medium shrink-0"
        style={{ background: "var(--surface-3)", color: "var(--text-1)" }}
      >
        {integration.name?.charAt(0).toUpperCase() || "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>
            {integration.name}
          </p>
          {integration.is_active && (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--green)" }} />
          )}
        </div>
        <p className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>
          {integration.shop?.name} · {integration.synced_count} produtos · {lastSync}
        </p>
      </div>
      <span
        className="text-[10px] px-2 py-0.5 rounded-full font-medium"
        style={{
          background: ok ? "var(--green-soft)" : "var(--surface-3)",
          color: ok ? "var(--green)" : "var(--text-3)",
        }}
      >
        {ok ? "OK" : integration.last_sync_status || "—"}
      </span>
    </div>
  );
}

function ProviderCard({ provider }: { provider: Provider }) {
  const ready = provider.status === "ready";
  return (
    <div
      className="rounded-xl p-4 flex flex-col"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-base font-semibold shrink-0"
            style={{ background: "var(--surface-3)", color: "var(--text-1)" }}
          >
            {provider.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>
              {provider.name}
            </p>
            <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
              {provider.region}
            </p>
          </div>
        </div>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap"
          style={{
            background: ready ? "var(--green-soft)" : "var(--surface-3)",
            color: ready ? "var(--green)" : "var(--text-3)",
          }}
        >
          {ready ? "Disponível" : "Em breve"}
        </span>
      </div>
      <p className="text-xs flex-1 mb-3" style={{ color: "var(--text-2)" }}>
        {provider.description}
      </p>
      <button
        disabled={!ready}
        className="text-xs font-medium py-1.5 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: ready ? "var(--green)" : "var(--surface-3)",
          color: ready ? "var(--green-fg)" : "var(--text-3)",
        }}
      >
        Conectar <ExternalLink className="w-3 h-3" />
      </button>
    </div>
  );
}
