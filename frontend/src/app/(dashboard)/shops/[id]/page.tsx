"use client";

import { useState, use } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ShoppingBag, Package, Plus, Loader2, Pencil, Trash2,
  X, ImageIcon, Box, ExternalLink, Settings, Search,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

interface Product {
  id: string;
  shop_id: string;
  name: string;
  slug: string;
  description?: string;
  type: "physical" | "digital" | "service";
  price: number;
  compare_at_price: number;
  currency: string;
  stock_quantity: number;
  track_stock: boolean;
  main_image?: string;
  is_active: boolean;
  sku?: string;
  external_provider?: string;
  created_at: string;
}

type Tab = "products" | "integrations" | "settings";

export default function ShopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: shopId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id;
  const headers = wsId ? { "X-Workspace-ID": wsId } : undefined;

  const [tab, setTab] = useState<Tab>("products");
  const [search, setSearch] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);

  const { data: shop, isLoading: loadingShop } = useQuery<Shop>({
    queryKey: ["shop", shopId, wsId],
    queryFn: () => api.get(`/v1/shops/${shopId}`, { headers }).then((r) => r.data),
    enabled: !!wsId && !!shopId,
  });

  const { data: productsRes, isLoading: loadingProducts } = useQuery<{ data: Product[] }>({
    queryKey: ["shop-products", shopId, wsId],
    queryFn: () => api.get(`/v1/shops/${shopId}/products`, { headers }).then((r) => r.data),
    enabled: !!wsId && !!shopId,
  });
  const products = productsRes?.data ?? [];

  const filtered = search
    ? products.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku?.toLowerCase().includes(search.toLowerCase()),
      )
    : products;

  const deleteProductMut = useMutation({
    mutationFn: (productId: string) =>
      api.delete(`/v1/shops/${shopId}/products/${productId}`, { headers }),
    onSuccess: () => {
      toast.success("Produto removido");
      qc.invalidateQueries({ queryKey: ["shop-products", shopId] });
    },
    onError: () => toast.error("Erro ao remover"),
  });

  if (loadingShop) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--green)" }} />
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12 text-center">
        <p className="text-sm" style={{ color: "var(--text-3)" }}>Loja não encontrada.</p>
        <button onClick={() => router.push("/shops")} className="mt-4 text-xs underline">
          Voltar pra Shops
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 lg:py-8">
      {/* Header */}
      <button
        onClick={() => router.push("/shops")}
        className="flex items-center gap-1.5 text-xs mb-4 transition-colors"
        style={{ color: "var(--text-3)" }}
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Voltar pra Shops
      </button>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex items-center gap-3">
          {shop.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shop.logo_url} alt={shop.name} className="w-14 h-14 rounded-xl object-cover" />
          ) : (
            <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: "var(--green-soft)" }}>
              <ShoppingBag className="w-6 h-6" style={{ color: "var(--green)" }} />
            </div>
          )}
          <div>
            <h1 className="text-xl font-medium" style={{ color: "var(--text-1)" }}>{shop.name}</h1>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>
              {shop.slug} · {shop.currency} ·{" "}
              {shop.visibility === "public"
                ? "🌎 Pública"
                : shop.visibility === "link_only"
                ? "🔗 Link-only"
                : "🔒 Privada"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{
              background: shop.is_active ? "var(--green-soft)" : "var(--surface-3)",
              color: shop.is_active ? "var(--green)" : "var(--text-3)",
            }}
          >
            {shop.is_active ? "ATIVA" : "INATIVA"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: "var(--surface-border)" }}>
        <TabBtn icon={Package} label="Produtos" count={products.length} active={tab === "products"} onClick={() => setTab("products")} />
        <TabBtn icon={Box} label="Integrações" active={tab === "integrations"} onClick={() => setTab("integrations")} />
        <TabBtn icon={Settings} label="Configurações" active={tab === "settings"} onClick={() => setTab("settings")} />
      </div>

      {tab === "products" && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou SKU"
                className="input-field w-full pl-9"
              />
            </div>
            <button
              onClick={() => setCreatingProduct(true)}
              className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}
            >
              <Plus className="w-3.5 h-3.5" /> Novo produto
            </button>
          </div>

          {loadingProducts ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} />
            </div>
          ) : filtered.length === 0 ? (
            <div
              className="text-center py-16 rounded-2xl"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
            >
              <Package className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--text-3)" }} />
              <p className="text-sm font-medium mb-1" style={{ color: "var(--text-1)" }}>
                {search ? "Nenhum produto encontrado" : "Nenhum produto ainda"}
              </p>
              <p className="text-xs mb-4" style={{ color: "var(--text-3)" }}>
                {search ? "Ajuste a busca." : "Crie produtos manualmente ou conecte uma integração pra sincronizar do seu e-commerce."}
              </p>
              {!search && (
                <button
                  onClick={() => setCreatingProduct(true)}
                  className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
                  style={{ background: "var(--green)", color: "var(--green-fg)" }}
                >
                  <Plus className="w-3.5 h-3.5" /> Criar primeiro produto
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onEdit={() => setEditingProduct(p)}
                  onDelete={() => {
                    if (confirm(`Remover "${p.name}"?`)) deleteProductMut.mutate(p.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "integrations" && (
        <div
          className="rounded-2xl p-6"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
        >
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-1)" }}>Integrações da loja</h3>
          <p className="text-xs mb-4" style={{ color: "var(--text-3)" }}>
            Conecte Shopify, Mercado Livre, VTEX, Magalu, Amazon, Shopee, WooCommerce, BigCommerce, eBay ou WhatsApp Catalog pra sincronizar produtos automaticamente.
          </p>
          <Link
            href={`/integrations?section=shop&shop_id=${shopId}`}
            className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}
          >
            Gerenciar integrações <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      )}

      {tab === "settings" && (
        <ShopSettingsForm shop={shop} headers={headers} />
      )}

      {(creatingProduct || editingProduct) && (
        <ProductFormModal
          shopId={shopId}
          shop={shop}
          headers={headers}
          existing={editingProduct}
          onClose={() => {
            setCreatingProduct(false);
            setEditingProduct(null);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["shop-products", shopId] });
            setCreatingProduct(false);
            setEditingProduct(null);
          }}
        />
      )}
    </div>
  );
}

function TabBtn({ icon: Icon, label, count, active, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-2 text-xs font-medium inline-flex items-center gap-1.5 border-b-2 -mb-px transition-colors"
      style={{
        borderColor: active ? "var(--green)" : "transparent",
        color: active ? "var(--text-1)" : "var(--text-3)",
      }}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {typeof count === "number" && (
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-3)" }}>
          {count}
        </span>
      )}
    </button>
  );
}

function ProductCard({ product, onEdit, onDelete }: {
  product: Product; onEdit: () => void; onDelete: () => void;
}) {
  const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: product.currency || "BRL" });
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
    >
      <div className="aspect-video relative" style={{ background: "var(--surface-3)" }}>
        {product.main_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.main_image} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-8 h-8" style={{ color: "var(--text-4)" }} />
          </div>
        )}
        {product.external_provider && (
          <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: "rgba(0,0,0,0.6)", color: "white" }}>
            {product.external_provider}
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{product.name}</p>
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-sm font-medium" style={{ color: "var(--green)" }}>
            {fmt.format(product.price)}
          </p>
          {product.track_stock && (
            <span className="text-[11px]" style={{ color: product.stock_quantity > 0 ? "var(--text-3)" : "#f87171" }}>
              {product.stock_quantity > 0 ? `${product.stock_quantity} em estoque` : "Sem estoque"}
            </span>
          )}
        </div>
        {product.sku && (
          <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>SKU {product.sku}</p>
        )}
        <div className="flex items-center gap-1 mt-3">
          <button
            onClick={onEdit}
            className="flex-1 text-xs font-medium py-1.5 rounded-md inline-flex items-center justify-center gap-1"
            style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
          >
            <Pencil className="w-3 h-3" /> Editar
          </button>
          <button
            onClick={onDelete}
            disabled={!!product.external_provider}
            title={product.external_provider ? "Produto sincronizado — gerencie no provider" : ""}
            className="px-2 py-1.5 rounded-md disabled:opacity-30"
            style={{ background: "var(--surface-3)", color: "#f87171" }}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductFormModal({ shopId, shop, headers, existing, onClose, onSaved }: {
  shopId: string;
  shop: Shop;
  headers?: Record<string, string>;
  existing: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: existing?.name ?? "",
    description: existing?.description ?? "",
    type: existing?.type ?? "physical",
    price: existing?.price ?? 0,
    compare_at_price: existing?.compare_at_price ?? 0,
    currency: existing?.currency ?? shop.currency,
    sku: existing?.sku ?? "",
    stock_quantity: existing?.stock_quantity ?? 0,
    track_stock: existing?.track_stock ?? true,
    main_image: existing?.main_image ?? "",
    is_active: existing?.is_active ?? true,
  });

  const saveMut = useMutation({
    mutationFn: () => existing
      ? api.patch(`/v1/shops/${shopId}/products/${existing.id}`, form, { headers })
      : api.post(`/v1/shops/${shopId}/products`, form, { headers }),
    onSuccess: () => {
      toast.success(existing ? "Produto atualizado" : "Produto criado");
      onSaved();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.message
        || (e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro";
      toast.error(msg);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="w-full max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
        <div className="flex items-center justify-between p-4 border-b sticky top-0" style={{ borderColor: "var(--surface-border)", background: "var(--surface-1)" }}>
          <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
            {existing ? "Editar produto" : "Novo produto"}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="p-4 space-y-3">
          <Field label="Nome">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-field w-full" placeholder="Camiseta Basic Branca" />
          </Field>
          <Field label="Descrição">
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-field w-full" rows={3} placeholder="Detalhes do produto" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Product["type"] })}
                className="input-field w-full">
                <option value="physical">Físico</option>
                <option value="digital">Digital</option>
                <option value="service">Serviço</option>
              </select>
            </Field>
            <Field label="Moeda">
              <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                className="input-field w-full" maxLength={3} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preço">
              <input type="number" step="0.01" required value={form.price}
                onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })}
                className="input-field w-full" />
            </Field>
            <Field label="Preço comparativo (de)">
              <input type="number" step="0.01" value={form.compare_at_price}
                onChange={(e) => setForm({ ...form, compare_at_price: parseFloat(e.target.value) || 0 })}
                className="input-field w-full" />
            </Field>
          </div>
          <Field label="SKU">
            <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
              className="input-field w-full" placeholder="opcional" />
          </Field>
          {form.type === "physical" && (
            <div className="grid grid-cols-2 gap-3 items-end">
              <Field label="Estoque">
                <input type="number" value={form.stock_quantity}
                  onChange={(e) => setForm({ ...form, stock_quantity: parseInt(e.target.value) || 0 })}
                  className="input-field w-full" />
              </Field>
              <label className="flex items-center gap-2 text-xs pb-2.5" style={{ color: "var(--text-2)" }}>
                <input type="checkbox" checked={form.track_stock}
                  onChange={(e) => setForm({ ...form, track_stock: e.target.checked })} />
                Controlar estoque
              </label>
            </div>
          )}
          <Field label="URL da imagem principal">
            <input value={form.main_image} onChange={(e) => setForm({ ...form, main_image: e.target.value })}
              className="input-field w-full" placeholder="https://…" />
          </Field>
          <label className="flex items-center gap-2 text-xs pt-1" style={{ color: "var(--text-2)" }}>
            <input type="checkbox" checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Produto ativo (visível pra clientes)
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: "var(--surface-border)" }}>
            <button type="button" onClick={onClose} className="text-xs px-3 py-2 rounded-lg"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
              Cancelar
            </button>
            <button type="submit" disabled={saveMut.isPending}
              className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}>
              {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {existing ? "Salvar" : "Criar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ShopSettingsForm({ shop, headers }: { shop: Shop; headers?: Record<string, string> }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: shop.name,
    description: shop.description ?? "",
    currency: shop.currency,
    visibility: shop.visibility,
    is_active: shop.is_active,
    logo_url: shop.logo_url ?? "",
  });

  const saveMut = useMutation({
    mutationFn: () => api.patch(`/v1/shops/${shop.id}`, form, { headers }),
    onSuccess: () => {
      toast.success("Loja atualizada");
      qc.invalidateQueries({ queryKey: ["shop", shop.id] });
      qc.invalidateQueries({ queryKey: ["shops"] });
    },
    onError: () => toast.error("Erro ao salvar"),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }}
      className="max-w-xl space-y-4 rounded-2xl p-5"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <Field label="Nome">
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="input-field w-full" />
      </Field>
      <Field label="Descrição">
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="input-field w-full" rows={3} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Moeda">
          <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
            className="input-field w-full" maxLength={3} />
        </Field>
        <Field label="Visibilidade">
          <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as Shop["visibility"] })}
            className="input-field w-full">
            <option value="private">Privada</option>
            <option value="link_only">Acesso por link</option>
            <option value="public">Pública</option>
          </select>
        </Field>
      </div>
      <Field label="Logo (URL)">
        <input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
          className="input-field w-full" placeholder="https://…" />
      </Field>
      <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-2)" }}>
        <input type="checkbox" checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
        Loja ativa
      </label>
      <div className="flex justify-end pt-2 border-t" style={{ borderColor: "var(--surface-border)" }}>
        <button type="submit" disabled={saveMut.isPending}
          className="text-xs font-medium px-4 py-2 rounded-lg inline-flex items-center gap-1.5"
          style={{ background: "var(--green)", color: "var(--green-fg)" }}>
          {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Salvar alterações
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}
