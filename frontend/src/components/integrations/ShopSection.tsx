"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Store,
  X,
  Key,
  Globe,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import api from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

interface ProviderField {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password" | "url";
  required: boolean;
}

interface Provider {
  id: string;
  name: string;
  region: string;
  description: string;
  status: "ready" | "coming_soon";
  auth_mode: string;
  fields: ProviderField[] | null;
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

const PROVIDER_BRAND: Record<string, { bg: string; fg: string; mark?: string }> = {
  shopify:          { bg: "#95BF47", fg: "#FFFFFF", mark: "S" },
  mercado_livre:    { bg: "#FFE600", fg: "#003F8D", mark: "ML" },
  vtex:             { bg: "#F71963", fg: "#FFFFFF", mark: "V" },
  magalu:           { bg: "#0086FF", fg: "#FFFFFF", mark: "ML" },
  shopee:           { bg: "#EE4D2D", fg: "#FFFFFF", mark: "S" },
  amazon:           { bg: "#FF9900", fg: "#232F3E", mark: "a" },
  ebay:             { bg: "#E53238", fg: "#FFFFFF", mark: "e" },
  woocommerce:      { bg: "#7F54B3", fg: "#FFFFFF", mark: "Wc" },
  bigcommerce:      { bg: "#121118", fg: "#34313F", mark: "BC" },
  whatsapp_catalog: { bg: "#25D366", fg: "#FFFFFF", mark: "Wa" },
  tray:             { bg: "#0066FF", fg: "#FFFFFF", mark: "T" },
  bling:            { bg: "#FBBF24", fg: "#0F172A", mark: "B" },
  nuvemshop:        { bg: "#001A36", fg: "#FFC633", mark: "Ns" },
};

// ─── ConnectModal ──────────────────────────────────────────────────────────────

interface ConnectModalProps {
  provider: Provider;
  shops: Shop[];
  wsId: string;
  onClose: () => void;
}

function ConnectModal({ provider, shops, wsId, onClose }: ConnectModalProps) {
  const queryClient = useQueryClient();
  const hasFields = provider.fields && provider.fields.length > 0;
  const singleShop = shops.length === 1;

  const [step, setStep] = useState<"shop" | "credentials">(
    singleShop ? "credentials" : "shop"
  );
  const [selectedShop, setSelectedShop] = useState<string>(
    singleShop ? shops[0].id : ""
  );
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const headers = { "X-Workspace-ID": wsId };
  const brand = PROVIDER_BRAND[provider.id] || {
    bg: "var(--surface-3)",
    fg: "var(--text-1)",
    mark: provider.name.charAt(0),
  };

  async function handleConnect() {
    setLoading(true);
    try {
      // 1. Criar draft da integração
      const createRes = await api.post(
        `/v1/shops/${selectedShop}/integrations`,
        {
          provider: provider.id,
          name: provider.name,
          config:
            Object.keys(fieldValues).length > 0
              ? JSON.stringify(fieldValues)
              : "{}",
        },
        { headers }
      );
      const integId = createRes.data.id;

      if (provider.auth_mode === "oauth2") {
        // 2a. Obter URL OAuth
        const connectRes = await api.post(
          `/v1/shops/${selectedShop}/integrations/${integId}/connect`,
          {},
          { headers }
        );
        window.open(connectRes.data.auth_url, "_blank", "width=600,height=700");
        toast.success(
          "Janela de autorização aberta. Após autorizar, volte aqui e a integração será ativada."
        );
      } else {
        // 2b. Salvar credenciais
        await api.patch(
          `/v1/shops/${selectedShop}/integrations/${integId}`,
          {
            credentials: JSON.stringify(fieldValues),
            is_active: true,
          },
          { headers }
        );
        toast.success(`${provider.name} conectado com sucesso!`);
        queryClient.invalidateQueries({ queryKey: ["shop-integrations-all"] });
      }
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      toast.error(msg || "Erro ao conectar integração");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    selectedShop !== "" &&
    (!hasFields ||
      (provider.fields ?? [])
        .filter((f) => f.required)
        .every((f) => fieldValues[f.key]?.trim()));

  return (
    // Overlay
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Dialog */}
      <div
        className="relative w-full max-w-md rounded-2xl p-6 flex flex-col gap-5"
        style={{
          background: "rgba(18,18,20,0.95)",
          border: "1px solid rgba(255,255,255,0.1)",
          backdropFilter: "blur(24px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
          style={{
            background: "rgba(255,255,255,0.06)",
            color: "var(--text-3)",
          }}
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center font-bold shrink-0"
            style={{
              background: brand.bg,
              color: brand.fg,
              fontSize: brand.mark && brand.mark.length > 1 ? "13px" : "20px",
            }}
          >
            {brand.mark || provider.name.charAt(0)}
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
              Conectar {provider.name}
            </p>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>
              {provider.description}
            </p>
          </div>
        </div>

        {/* Step: shop selector */}
        {step === "shop" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
              Selecione a loja para conectar:
            </p>
            <div className="flex flex-col gap-2">
              {shops.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedShop(s.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all"
                  style={{
                    background:
                      selectedShop === s.id
                        ? "rgba(var(--green-rgb, 34,197,94),0.12)"
                        : "rgba(255,255,255,0.04)",
                    border:
                      selectedShop === s.id
                        ? "1px solid var(--green)"
                        : "1px solid rgba(255,255,255,0.07)",
                    color:
                      selectedShop === s.id ? "var(--green)" : "var(--text-1)",
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <button
              disabled={!selectedShop}
              onClick={() => setStep("credentials")}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "var(--green)",
                color: "var(--green-fg)",
              }}
            >
              Continuar
            </button>
          </div>
        )}

        {/* Step: credentials */}
        {step === "credentials" && (
          <div className="flex flex-col gap-4">
            {!singleShop && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep("shop")}
                  className="text-[11px]"
                  style={{ color: "var(--text-3)" }}
                >
                  ← Trocar loja
                </button>
                <span className="text-[11px]" style={{ color: "var(--text-2)" }}>
                  {shops.find((s) => s.id === selectedShop)?.name}
                </span>
              </div>
            )}

            {/* Auth mode badge */}
            <div className="flex items-center gap-2">
              {provider.auth_mode === "oauth2" ? (
                <span
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: "rgba(59,130,246,0.12)",
                    color: "#3b82f6",
                  }}
                >
                  <Globe className="w-2.5 h-2.5" /> OAuth 2.0
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: "rgba(245,158,11,0.12)",
                    color: "#f59e0b",
                  }}
                >
                  <Key className="w-2.5 h-2.5" /> API Key
                </span>
              )}
            </div>

            {/* Fields */}
            {hasFields && (
              <div className="flex flex-col gap-3">
                {(provider.fields ?? []).map((field) => (
                  <div key={field.key} className="flex flex-col gap-1.5">
                    <label
                      className="text-xs font-medium"
                      style={{ color: "var(--text-2)" }}
                    >
                      {field.label}
                      {field.required && (
                        <span style={{ color: "var(--green)" }}> *</span>
                      )}
                    </label>
                    <input
                      type={field.type === "password" ? "password" : "text"}
                      placeholder={field.placeholder}
                      value={fieldValues[field.key] ?? ""}
                      onChange={(e) =>
                        setFieldValues((prev) => ({
                          ...prev,
                          [field.key]: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "var(--text-1)",
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {!hasFields && provider.auth_mode === "oauth2" && (
              <p className="text-xs" style={{ color: "var(--text-3)" }}>
                Você será redirecionado para autorizar o acesso na plataforma{" "}
                {provider.name}.
              </p>
            )}

            <button
              disabled={!canSubmit || loading}
              onClick={handleConnect}
              className="w-full py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "var(--green)",
                color: "var(--green-fg)",
              }}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : provider.auth_mode === "oauth2" ? (
                <>
                  Autorizar acesso <ExternalLink className="w-3.5 h-3.5" />
                </>
              ) : (
                "Conectar"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ProviderCard ──────────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: Provider;
  onConnect: () => void;
}

function ProviderCard({ provider, onConnect }: ProviderCardProps) {
  const ready = provider.status === "ready";
  const brand = PROVIDER_BRAND[provider.id] || {
    bg: "var(--surface-3)",
    fg: "var(--text-1)",
    mark: provider.name.charAt(0),
  };

  const authBadge =
    provider.auth_mode === "oauth2"
      ? { label: "OAuth", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" }
      : { label: "API Key", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" };

  return (
    <div
      className="group relative rounded-2xl p-4 flex flex-col items-center text-center transition-all hover:scale-[1.02]"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Status badge — canto superior direito */}
      <span
        className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider"
        style={{
          background: ready ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.12)",
          color: ready ? "#22c55e" : "var(--text-3)",
        }}
      >
        {ready ? "Disponível" : "Em breve"}
      </span>

      {/* Logo box */}
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold mb-3 mt-1"
        style={{
          background: brand.bg,
          color: brand.fg,
          fontSize: brand.mark && brand.mark.length > 1 ? "14px" : "22px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      >
        {brand.mark || provider.name.charAt(0)}
      </div>

      <p className="text-sm font-medium leading-tight" style={{ color: "var(--text-1)" }}>
        {provider.name}
      </p>

      {/* Auth mode badge */}
      <span
        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-medium mt-1 mb-2"
        style={{ background: authBadge.bg, color: authBadge.color }}
      >
        {authBadge.label}
      </span>

      <p
        className="text-[11px] leading-relaxed flex-1 mb-3 line-clamp-2"
        style={{ color: "var(--text-2)" }}
      >
        {provider.description}
      </p>

      <button
        disabled={!ready}
        onClick={onConnect}
        className="w-full text-xs font-medium py-2 rounded-lg inline-flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: ready ? "var(--green)" : "var(--surface-3)",
          color: ready ? "var(--green-fg)" : "var(--text-3)",
        }}
      >
        Conectar
      </button>
    </div>
  );
}

// ─── ActiveIntegrationCard ─────────────────────────────────────────────────────

function ActiveIntegrationCard({
  integration,
}: {
  integration: Integration & { shop?: Shop };
}) {
  const ok =
    integration.last_sync_status === "ok" ||
    integration.last_sync_status === "success";
  const lastSync = integration.last_sync_at
    ? new Date(integration.last_sync_at).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "nunca";

  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-medium shrink-0"
        style={{ background: "var(--surface-3)", color: "var(--text-1)" }}
      >
        {integration.name?.charAt(0).toUpperCase() || "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p
            className="text-sm font-medium truncate"
            style={{ color: "var(--text-1)" }}
          >
            {integration.name}
          </p>
          {integration.is_active && (
            <CheckCircle2
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: "var(--green)" }}
            />
          )}
        </div>
        <p className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>
          {integration.shop?.name} · {integration.synced_count} produtos ·{" "}
          {lastSync}
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

// ─── ShopSection ───────────────────────────────────────────────────────────────

export function ShopSection() {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";
  const headers = wsId ? { "X-Workspace-ID": wsId } : undefined;

  const [connectingProvider, setConnectingProvider] = useState<Provider | null>(null);

  const { data: providers = [], isLoading } = useQuery<Provider[]>({
    queryKey: ["shop-providers"],
    queryFn: () => api.get("/v1/shop/providers").then((r) => r.data),
  });

  const { data: shopsData } = useQuery<{ data: Shop[] }>({
    queryKey: ["shops", wsId],
    queryFn: () => api.get("/v1/shops", { headers }).then((r) => r.data),
    enabled: !!wsId,
  });
  const shops = shopsData?.data ?? [];

  const { data: integrationsByShop = {} } = useQuery<
    Record<string, Integration[]>
  >({
    queryKey: [
      "shop-integrations-all",
      wsId,
      shops.map((s) => s.id).join(","),
    ],
    queryFn: async () => {
      const map: Record<string, Integration[]> = {};
      await Promise.all(
        shops.map(async (s) => {
          try {
            const r = await api.get(`/v1/shops/${s.id}/integrations`, {
              headers,
            });
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

  const allIntegrations: (Integration & { shop?: Shop })[] = shops.flatMap(
    (s) => (integrationsByShop[s.id] ?? []).map((i) => ({ ...i, shop: s }))
  );

  // Ordenar alfabeticamente por nome
  const sortedProviders = [...providers].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR")
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <ShoppingBag
            className="w-4 h-4"
            style={{ color: "var(--green)" }}
          />
          <h2
            className="text-base font-medium"
            style={{ color: "var(--text-1)" }}
          >
            Integrações de Shop
          </h2>
        </div>
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          Conecte seu catálogo a plataformas de e-commerce (Shopify, Mercado
          Livre, VTEX, Magalu, Amazon...). Produtos sincronizam
          automaticamente. Use em campanhas, journeys e agentes IA.
        </p>
      </div>

      {/* Banner sem shop */}
      {shops.length === 0 ? (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{
            background: "var(--green-soft)",
            border: "1px solid var(--green-border)",
          }}
        >
          <ShoppingBag
            className="w-5 h-5 mt-0.5 shrink-0"
            style={{ color: "var(--green)" }}
          />
          <div className="flex-1">
            <p
              className="text-sm font-medium mb-0.5"
              style={{ color: "var(--text-1)" }}
            >
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
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--surface-border)",
          }}
        >
          <Store
            className="w-5 h-5 mt-0.5 shrink-0"
            style={{ color: "var(--text-3)" }}
          />
          <div className="flex-1">
            <p
              className="text-sm font-medium mb-0.5"
              style={{ color: "var(--text-1)" }}
            >
              Nenhuma integração ativa
            </p>
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              Você tem {shops.length} loja{shops.length > 1 ? "s" : ""}. Conecte
              uma das plataformas abaixo pra começar a sincronizar produtos.
            </p>
          </div>
        </div>
      ) : (
        /* Integrações ativas */
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p
              className="text-xs font-medium uppercase tracking-wider"
              style={{ color: "var(--text-2)" }}
            >
              Integrações ativas{" "}
              <span
                className="ml-1 normal-case font-normal"
                style={{ color: "var(--text-3)" }}
              >
                ({allIntegrations.length})
              </span>
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

      {/* Grid de providers */}
      {isLoading ? (
        <div className="text-center py-8" style={{ color: "var(--text-3)" }}>
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </div>
      ) : (
        <div>
          <p
            className="text-xs font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--text-2)" }}
          >
            Plataformas disponíveis{" "}
            <span
              className="ml-1 normal-case font-normal"
              style={{ color: "var(--text-3)" }}
            >
              ({sortedProviders.length})
            </span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {sortedProviders.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                onConnect={() => {
                  if (shops.length === 0) {
                    toast.error("Crie uma loja antes de conectar uma integração.");
                    return;
                  }
                  setConnectingProvider(p);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Connect Modal */}
      {connectingProvider && wsId && (
        <ConnectModal
          provider={connectingProvider}
          shops={shops}
          wsId={wsId}
          onClose={() => setConnectingProvider(null)}
        />
      )}
    </div>
  );
}
