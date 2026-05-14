"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { brandingApi } from "@/lib/api";
import { useBranding, THEME_PRESETS } from "@/features/branding/BrandingProvider";
import { BrandingConfig, DEFAULT_BRANDING } from "@/features/branding/types";

type UploadKind = "logo_light" | "logo_dark" | "favicon" | "login_bg";

export default function AdminBrandingPage() {
  const { branding, setBranding, reload } = useBranding();
  const [draft, setDraft] = useState<BrandingConfig>(branding);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<UploadKind | null>(null);
  const initial = useRef(branding);

  // Sincroniza draft quando o provider carrega o público pela primeira vez.
  useEffect(() => {
    if (initial.current !== branding) return;
    setDraft(branding);
  }, [branding]);

  const onField = <K extends keyof BrandingConfig>(key: K, value: BrandingConfig[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    // Preview ao vivo aplicando no provider sem persistir.
    setBranding({ [key]: value } as Partial<BrandingConfig>);
  };

  const save = async () => {
    setSaving(true);
    try {
      await brandingApi.update(draft);
      toast.success("Branding salvo");
      await reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: UploadKind, file: File) => {
    setUploading(kind);
    try {
      const res = await brandingApi.upload(kind, file);
      const url = res.data.url;
      const field = (kind + "_url") as keyof BrandingConfig;
      onField(field, url as any);
      toast.success("Upload concluído");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Erro no upload");
    } finally {
      setUploading(null);
    }
  };

  const reset = () => {
    setDraft(DEFAULT_BRANDING);
    setBranding(DEFAULT_BRANDING);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Branding</h1>
        <p className="text-sm text-muted-foreground">
          Customize a identidade visual do app. As mudanças se aplicam imediatamente
          em modo preview — clique em <strong>Salvar</strong> para persistir.
        </p>
      </header>

      {/* Identidade */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Identidade</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nome do app">
            <input
              type="text"
              value={draft.app_name}
              onChange={(e) => onField("app_name", e.target.value)}
              className="w-full px-3 py-2 rounded-md border bg-background"
              placeholder="Sua Marca"
            />
          </Field>
          <Field label="Família tipográfica (override do preset)">
            <input
              type="text"
              value={draft.font_family}
              onChange={(e) => onField("font_family", e.target.value)}
              className="w-full px-3 py-2 rounded-md border bg-background"
              placeholder="inter"
            />
          </Field>
        </div>
      </section>

      {/* Cores */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Cores</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ColorField label="Primária" value={draft.primary_color} onChange={(v) => onField("primary_color", v)} />
          <ColorField label="Secundária" value={draft.secondary_color} onChange={(v) => onField("secondary_color", v)} />
          <ColorField label="Destaque" value={draft.accent_color} onChange={(v) => onField("accent_color", v)} />
        </div>
      </section>

      {/* Preset */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Estilo (preset)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onField("theme_preset", p.value)}
              className={`text-left p-4 rounded-lg border-2 transition ${
                draft.theme_preset === p.value
                  ? "border-brand-primary bg-brand/5"
                  : "border-border hover:border-foreground/30"
              }`}
            >
              <div className="font-medium">{p.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{p.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Assets */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Assets</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <AssetField
            label="Logo (tema claro)"
            value={draft.logo_light_url}
            onUrl={(v) => onField("logo_light_url", v)}
            onFile={(f) => upload("logo_light", f)}
            uploading={uploading === "logo_light"}
          />
          <AssetField
            label="Logo (tema escuro)"
            value={draft.logo_dark_url}
            onUrl={(v) => onField("logo_dark_url", v)}
            onFile={(f) => upload("logo_dark", f)}
            uploading={uploading === "logo_dark"}
          />
          <AssetField
            label="Favicon"
            value={draft.favicon_url}
            onUrl={(v) => onField("favicon_url", v)}
            onFile={(f) => upload("favicon", f)}
            uploading={uploading === "favicon"}
          />
          <AssetField
            label="Background do Login"
            value={draft.login_bg_url}
            onUrl={(v) => onField("login_bg_url", v)}
            onFile={(f) => upload("login_bg", f)}
            uploading={uploading === "login_bg"}
          />
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t">
        <button
          type="button"
          onClick={reset}
          className="px-4 py-2 rounded-md border hover:bg-muted text-sm"
        >
          Resetar para defaults
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-5 py-2 rounded-md bg-brand-primary text-white font-medium disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 rounded border bg-background cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-3 py-2 rounded-md border bg-background font-mono text-sm"
          placeholder="#6366F1"
        />
      </div>
    </Field>
  );
}

function AssetField({
  label,
  value,
  onUrl,
  onFile,
  uploading,
}: {
  label: string;
  value: string;
  onUrl: (v: string) => void;
  onFile: (f: File) => void;
  uploading: boolean;
}) {
  return (
    <Field label={label}>
      <div className="space-y-2">
        {value && (
          <div className="flex items-center gap-3 p-2 rounded border bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt={label} className="h-12 w-12 object-contain rounded" />
            <span className="text-xs text-muted-foreground truncate flex-1">{value}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onUrl(e.target.value)}
            placeholder="URL ou faça upload"
            className="flex-1 px-3 py-2 rounded-md border bg-background text-sm"
          />
          <label className="px-3 py-2 rounded-md border cursor-pointer hover:bg-muted text-sm whitespace-nowrap">
            {uploading ? "..." : "Upload"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </div>
    </Field>
  );
}
