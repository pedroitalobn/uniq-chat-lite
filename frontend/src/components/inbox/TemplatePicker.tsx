"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, Search, Sparkles, Image as ImageIcon, Video, FileText, MapPin, Save, Check } from "lucide-react";
import { wabaApi, conversationsApi, type WABATemplateDefault } from "@/lib/api";
import { TemplateMediaUpload } from "@/components/waba/TemplateMediaUpload";

// Meta message template — payload bruto da Graph API:
//   { name, language, category, components: [
//       { type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS",
//         format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION",
//         text?: "olá {{1}}, seu pedido…", buttons?: [...] }
//   ] }
//
// O componente extrai as {{N}} de BODY e HEADER(format=TEXT) e gera campos
// de texto. Pra HEADER com format IMAGE/VIDEO/DOCUMENT/LOCATION, mostra
// inputs específicos (URL pra mídia, lat/lng pra location). Ao enviar,
// monta `components` no formato exato que a Meta espera, evitando o erro
// 132012 ("expected IMAGE, received UNKNOWN") quando o template foi
// aprovado com mídia mas o request omite o parâmetro.

interface MetaTemplate {
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: Array<{
    type: string;
    text?: string;
    format?: string;
    example?: Record<string, unknown>;
    buttons?: Array<{ type: string; text: string }>;
  }>;
}

type HeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";

type MediaState = {
  url: string;
  filename: string; // pra DOCUMENT
  // pra LOCATION
  latitude: string;
  longitude: string;
  name: string;
  address: string;
};

const emptyMedia: MediaState = {
  url: "",
  filename: "",
  latitude: "",
  longitude: "",
  name: "",
  address: "",
};

export function TemplatePicker({
  wsId,
  conversationId,
  instanceId,
  onClose,
  onSent,
}: {
  wsId: string;
  conversationId: string;
  instanceId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<MetaTemplate | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [media, setMedia] = useState<MediaState>(emptyMedia);
  // Track se o user já mexeu no media depois do auto-fill — sem isso
  // a edição é sobrescrita quando o defaults query re-fetcha.
  const [mediaTouched, setMediaTouched] = useState(false);

  const templatesQ = useQuery({
    queryKey: ["waba-templates", instanceId],
    queryFn: () =>
      wabaApi.templates(instanceId).then((r) => (r.data as { items: MetaTemplate[] }).items ?? []),
  });

  // Defaults persistidos por (template_name, template_language). Auto-fill
  // os inputs de mídia quando o user seleciona um template — evita
  // digitar a URL toda vez (Meta exige link/handle fresco em cada envio,
  // mas a fonte não precisa mudar).
  const defaultsQ = useQuery({
    queryKey: ["waba-template-defaults", instanceId],
    queryFn: () => wabaApi.templateDefaults(instanceId).then((r) => r.data.items ?? []),
  });

  const saveDefault = useMutation({
    mutationFn: (data: WABATemplateDefault) =>
      wabaApi.saveTemplateDefault(instanceId, {
        template_name: data.template_name,
        template_language: data.template_language,
        header_media_url: data.header_media_url,
        header_filename: data.header_filename,
        header_latitude: data.header_latitude,
        header_longitude: data.header_longitude,
        header_location_name: data.header_location_name,
        header_location_address: data.header_location_address,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["waba-template-defaults", instanceId] });
      toast.success("Salvo como padrão pra próxima vez.");
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || "Falha ao salvar padrão"),
  });

  const send = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("no template");
      const components = buildMetaComponents(selected, variables, media);
      return conversationsApi.sendMessage(wsId, conversationId, {
        type: "template",
        template_name: selected.name,
        template_language: selected.language,
        template_components: components,
      });
    },
    onSuccess: () => {
      toast.success("Template enviado");
      onSent();
      onClose();
    },
    onError: (e: any) => {
      const raw = e?.response?.data?.error || "Falha ao enviar template";
      toast.error(raw, { duration: 8000 });
    },
  });

  const templates = useMemo(() => {
    const raw = templatesQ.data ?? [];
    if (!q) return raw;
    const t = q.toLowerCase();
    return raw.filter(
      (tpl) =>
        tpl.name.toLowerCase().includes(t) ||
        (tpl.category ?? "").toLowerCase().includes(t) ||
        getBodyText(tpl).toLowerCase().includes(t),
    );
  }, [templatesQ.data, q]);

  const vars = useMemo(() => (selected ? extractVariables(selected) : []), [selected]);
  const headerFormat = useMemo<HeaderFormat | null>(() => {
    const h = selected?.components?.find((c) => c.type === "HEADER");
    if (!h?.format) return null;
    const f = h.format.toUpperCase();
    if (["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(f)) {
      return f as HeaderFormat;
    }
    return null;
  }, [selected]);
  const needsMedia = headerFormat === "IMAGE" || headerFormat === "VIDEO" || headerFormat === "DOCUMENT";
  const needsLocation = headerFormat === "LOCATION";

  // Reset vars + media quando troca de template. Marca mediaTouched=false
  // pra permitir que o effect de auto-fill rode (abaixo).
  useEffect(() => {
    if (!selected) return;
    setVariables({});
    setMedia(emptyMedia);
    setMediaTouched(false);
  }, [selected]);

  // Auto-fill do media a partir dos defaults persistidos. Roda quando o
  // template selecionado ou os defaults mudam, mas só se o user ainda
  // não editou (mediaTouched=false) — assim a digitação manual nunca é
  // sobrescrita pelo refetch.
  useEffect(() => {
    if (!selected || mediaTouched) return;
    const def = (defaultsQ.data ?? []).find(
      (d) => d.template_name === selected.name && d.template_language === selected.language,
    );
    if (def) {
      setMedia({
        url: def.header_media_url ?? "",
        filename: def.header_filename ?? "",
        latitude: def.header_latitude != null && def.header_latitude !== 0 ? String(def.header_latitude) : "",
        longitude: def.header_longitude != null && def.header_longitude !== 0 ? String(def.header_longitude) : "",
        name: def.header_location_name ?? "",
        address: def.header_location_address ?? "",
      });
    }
  }, [selected, defaultsQ.data, mediaTouched]);

  // Wrapper do setter de media que marca como tocado — usado nos
  // inputs pra que o auto-fill (effect acima) só rode na primeira
  // seleção, não em cada refetch dos defaults.
  const updateMedia = (m: MediaState) => {
    setMediaTouched(true);
    setMedia(m);
  };

  // Tem default salvo bate com os valores atuais? (pra mostrar/esconder
  // o botão "Salvar como padrão")
  const currentDefault = useMemo(() => {
    if (!selected) return null;
    return (
      (defaultsQ.data ?? []).find(
        (d) => d.template_name === selected.name && d.template_language === selected.language,
      ) ?? null
    );
  }, [selected, defaultsQ.data]);

  const matchesDefault = useMemo(() => {
    if (!currentDefault) return false;
    return (
      (currentDefault.header_media_url ?? "") === media.url &&
      (currentDefault.header_filename ?? "") === media.filename &&
      String(currentDefault.header_latitude ?? "") === media.latitude &&
      String(currentDefault.header_longitude ?? "") === media.longitude &&
      (currentDefault.header_location_name ?? "") === media.name &&
      (currentDefault.header_location_address ?? "") === media.address
    );
  }, [currentDefault, media]);

  const canSend =
    !!selected &&
    vars.every((v) => (variables[v] ?? "").trim().length > 0) &&
    (!needsMedia || media.url.trim().length > 0) &&
    (!needsLocation || (media.latitude.trim() !== "" && media.longitude.trim() !== ""));

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 uniq-fade-in"
        style={{ background: "var(--surface-overlay)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div
        className="relative flex h-[640px] w-full max-w-3xl overflow-hidden rounded-2xl shadow-2xl uniq-scale-in"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}
      >
        {/* List */}
        <aside
          className="flex w-80 flex-shrink-0 flex-col"
          style={{ borderRight: "1px solid hsl(240 12% 16%)" }}
        >
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ borderBottom: "1px solid hsl(240 12% 16%)" }}
          >
            <Sparkles className="h-4 w-4" style={{ color: "#00d46a" }} />
            <h2 className="text-sm font-medium" style={{ color: "hsl(240 15% 93%)" }}>
              Templates aprovados
            </h2>
          </div>
          <div className="px-3 py-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5"
                style={{ color: "hsl(240 8% 38%)" }}
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar…"
                className="w-full rounded-md py-1.5 pl-8 pr-3 text-xs outline-none"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid hsl(240 12% 16%)",
                  color: "hsl(240 15% 90%)",
                }}
              />
            </div>
          </div>
          <ul className="flex-1 overflow-auto">
            {templatesQ.isLoading && (
              <li className="px-4 py-6 text-xs" style={{ color: "hsl(240 8% 48%)" }}>
                Carregando templates…
              </li>
            )}
            {templatesQ.isError && (
              <li className="px-4 py-6 text-xs" style={{ color: "#ef4444" }}>
                Falha ao buscar templates. Verifique se esta instância é WABA.
              </li>
            )}
            {!templatesQ.isLoading && templates.length === 0 && (
              <li className="px-4 py-6 text-xs" style={{ color: "hsl(240 8% 48%)" }}>
                Nenhum template aprovado.
              </li>
            )}
            {templates.map((tpl) => {
              const active = selected?.name === tpl.name && selected.language === tpl.language;
              const hf = tpl.components?.find((c) => c.type === "HEADER")?.format?.toUpperCase();
              return (
                <li key={`${tpl.name}-${tpl.language}`}>
                  <button
                    onClick={() => setSelected(tpl)}
                    className="block w-full px-4 py-3 text-left hover:bg-white/5"
                    style={{
                      background: active ? "rgba(0,212,106,0.06)" : "transparent",
                      borderLeft: active ? "2px solid #00d46a" : "2px solid transparent",
                    }}
                  >
                    <div
                      className="flex items-center gap-1.5 text-xs font-medium"
                      style={{ color: active ? "#00d46a" : "hsl(240 15% 90%)" }}
                    >
                      {tpl.name}
                      <span
                        className="rounded px-1 text-[9px]"
                        style={{ background: "var(--surface-2)", color: "hsl(240 8% 58%)" }}
                      >
                        {tpl.language}
                      </span>
                      {hf && hf !== "TEXT" && (
                        <span
                          className="rounded px-1 text-[9px] uppercase"
                          style={{
                            background: "rgba(96,165,250,0.10)",
                            color: "#60a5fa",
                            border: "1px solid rgba(96,165,250,0.20)",
                          }}
                          title="Header de mídia"
                        >
                          {hf.toLowerCase()}
                        </span>
                      )}
                    </div>
                    {tpl.category && (
                      <div className="mt-0.5 text-[10px]" style={{ color: "hsl(240 8% 38%)" }}>
                        {tpl.category}
                      </div>
                    )}
                    <div
                      className="mt-1 line-clamp-2 text-[11px]"
                      style={{ color: "hsl(240 8% 52%)" }}
                    >
                      {getBodyText(tpl) || "—"}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Detail + vars */}
        <main className="flex flex-1 flex-col">
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid hsl(240 12% 16%)" }}
          >
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium" style={{ color: "hsl(240 15% 93%)" }}>
                {selected?.name ?? "Selecione um template"}
              </h3>
              {selected && (
                <p className="text-[10px]" style={{ color: "hsl(240 8% 44%)" }}>
                  Idioma {selected.language} · {selected.category ?? "marketing"}
                  {headerFormat && headerFormat !== "TEXT" && (
                    <> · header <b style={{ color: "#60a5fa" }}>{headerFormat.toLowerCase()}</b></>
                  )}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 hover:bg-white/5"
              style={{ color: "hsl(240 8% 48%)" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-5">
            {!selected && (
              <div
                className="flex h-full items-center justify-center text-center text-xs"
                style={{ color: "hsl(240 8% 44%)" }}
              >
                Use templates aprovados para iniciar conversa fora da janela
                de 24h ou para mensagens promocionais sem o agente digitar
                todo o texto.
              </div>
            )}

            {selected && (
              <>
                <TemplatePreview tpl={selected} variables={variables} media={media} />

                {/* Inputs por formato de header */}
                {needsMedia && (
                  <MediaHeaderInputs
                    format={headerFormat as "IMAGE" | "VIDEO" | "DOCUMENT"}
                    media={media}
                    onChange={updateMedia}
                    hasDefault={!!currentDefault}
                    matchesDefault={matchesDefault}
                    onSaveDefault={() =>
                      selected &&
                      saveDefault.mutate({
                        id: "",
                        instance_id: "",
                        template_name: selected.name,
                        template_language: selected.language,
                        header_media_url: media.url,
                        header_filename: media.filename,
                      })
                    }
                    saving={saveDefault.isPending}
                    instanceId={instanceId}
                    templateName={selected.name}
                    templateLanguage={selected.language}
                  />
                )}

                {needsLocation && (
                  <LocationHeaderInputs
                    media={media}
                    onChange={updateMedia}
                    hasDefault={!!currentDefault}
                    matchesDefault={matchesDefault}
                    onSaveDefault={() =>
                      selected &&
                      saveDefault.mutate({
                        id: "",
                        instance_id: "",
                        template_name: selected.name,
                        template_language: selected.language,
                        header_latitude: parseFloat(media.latitude) || 0,
                        header_longitude: parseFloat(media.longitude) || 0,
                        header_location_name: media.name,
                        header_location_address: media.address,
                      })
                    }
                    saving={saveDefault.isPending}
                  />
                )}

                {/* Variáveis de texto (BODY + HEADER text) */}
                {vars.length > 0 && (
                  <div
                    className="mt-4 rounded-xl p-4"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid hsl(240 12% 16%)",
                    }}
                  >
                    <h4
                      className="mb-2 text-[10px] font-medium uppercase tracking-widest"
                      style={{ color: "hsl(240 8% 44%)" }}
                    >
                      Variáveis
                    </h4>
                    <div className="space-y-2">
                      {vars.map((v) => (
                        <label key={v} className="block">
                          <span
                            className="mb-1 block text-[10px]"
                            style={{ color: "hsl(240 8% 52%)" }}
                          >
                            {`{{${v}}}`}
                          </span>
                          <input
                            value={variables[v] ?? ""}
                            onChange={(e) =>
                              setVariables((prev) => ({ ...prev, [v]: e.target.value }))
                            }
                            placeholder={`Valor para {{${v}}}`}
                            className="w-full rounded-md px-3 py-2 text-xs outline-none"
                            style={{
                              background: "var(--surface-2)",
                              border: "1px solid hsl(240 12% 16%)",
                              color: "hsl(240 15% 90%)",
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div
            className="flex items-center justify-end gap-2 px-4 py-3"
            style={{ borderTop: "1px solid hsl(240 12% 16%)" }}
          >
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs"
              style={{
                background: "var(--surface-2)",
                border: "1px solid hsl(240 12% 16%)",
                color: "hsl(240 8% 62%)",
              }}
            >
              Cancelar
            </button>
            <button
              onClick={() => send.mutate()}
              disabled={!canSend || send.isPending}
              className="rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{ background: "#00d46a", color: "#03170a" }}
            >
              {send.isPending ? "Enviando…" : "Enviar template"}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Inputs por formato de header ──────────────────────────────────────────

function MediaHeaderInputs({
  format,
  media,
  onChange,
  hasDefault,
  matchesDefault,
  onSaveDefault,
  saving,
  instanceId,
  templateName,
  templateLanguage,
}: {
  format: "IMAGE" | "VIDEO" | "DOCUMENT";
  media: MediaState;
  onChange: (m: MediaState) => void;
  hasDefault: boolean;
  matchesDefault: boolean;
  onSaveDefault: () => void;
  saving: boolean;
  instanceId: string;
  templateName: string;
  templateLanguage: string;
}) {
  const meta = {
    IMAGE: { label: "Imagem", icon: ImageIcon, hint: "URL pública (.jpg/.png/.webp). Recomendado: até 5MB.", placeholder: "https://exemplo.com/imagem.jpg" },
    VIDEO: { label: "Vídeo", icon: Video, hint: "URL pública .mp4 (h264) ou .3gp. Recomendado: até 16MB.", placeholder: "https://exemplo.com/video.mp4" },
    DOCUMENT: { label: "Documento", icon: FileText, hint: "URL pública (.pdf é o mais usado). Até 100MB.", placeholder: "https://exemplo.com/arquivo.pdf" },
  }[format];
  const Icon = meta.icon;
  const canSave = media.url.trim().length > 0;
  return (
    <div
      className="mt-4 rounded-xl p-4 space-y-2"
      style={{
        background: "rgba(96,165,250,0.04)",
        border: "1px solid rgba(96,165,250,0.20)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h4
          className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest"
          style={{ color: "#60a5fa" }}
        >
          <Icon className="h-3 w-3" />
          Header · {meta.label}
          {hasDefault && matchesDefault && (
            <span className="inline-flex items-center gap-0.5 normal-case font-normal text-[10px] tracking-normal"
              style={{ color: "#00d46a" }}>
              <Check className="h-2.5 w-2.5" />
              padrão
            </span>
          )}
        </h4>
        {canSave && !matchesDefault && (
          <button
            type="button"
            onClick={onSaveDefault}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium disabled:opacity-50"
            style={{
              background: "rgba(0,212,106,0.10)",
              color: "#00d46a",
              border: "1px solid rgba(0,212,106,0.25)",
            }}
            title={hasDefault ? "Atualizar padrão pra este template" : "Salvar como padrão pra próxima vez"}
          >
            <Save className="h-2.5 w-2.5" />
            {hasDefault ? "Atualizar padrão" : "Salvar como padrão"}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={media.url}
          onChange={(e) => onChange({ ...media, url: e.target.value })}
          placeholder={meta.placeholder}
          className="flex-1 rounded-md px-3 py-2 text-xs outline-none"
          style={{
            background: "var(--surface-2)",
            border: "1px solid hsl(240 12% 16%)",
            color: "hsl(240 15% 90%)",
          }}
        />
        <TemplateMediaUpload
          instanceId={instanceId}
          templateName={templateName}
          templateLanguage={templateLanguage}
          format={format}
          saveAsDefault
          onUploaded={(url) => onChange({ ...media, url })}
        />
      </div>
      <p className="text-[10px]" style={{ color: "hsl(240 8% 48%)" }}>
        {meta.hint}
        {hasDefault && (
          <span className="ml-1" style={{ color: "#00d46a" }}>
            URL padrão carregada — ajuste se precisar.
          </span>
        )}
        <span className="ml-1" style={{ color: "hsl(240 8% 50%)" }}>
          Sem URL? Clique em <b>Subir arquivo</b> que a Uniq hospeda pra você.
        </span>
      </p>
      {format === "DOCUMENT" && (
        <input
          value={media.filename}
          onChange={(e) => onChange({ ...media, filename: e.target.value })}
          placeholder="Nome do arquivo (opcional, ex: Contrato.pdf)"
          className="w-full rounded-md px-3 py-2 text-xs outline-none"
          style={{
            background: "var(--surface-2)",
            border: "1px solid hsl(240 12% 16%)",
            color: "hsl(240 15% 90%)",
          }}
        />
      )}
    </div>
  );
}

function LocationHeaderInputs({
  media,
  onChange,
  hasDefault,
  matchesDefault,
  onSaveDefault,
  saving,
}: {
  media: MediaState;
  onChange: (m: MediaState) => void;
  hasDefault: boolean;
  matchesDefault: boolean;
  onSaveDefault: () => void;
  saving: boolean;
}) {
  const canSave = media.latitude.trim() !== "" && media.longitude.trim() !== "";
  return (
    <div
      className="mt-4 rounded-xl p-4 space-y-2"
      style={{
        background: "rgba(0,212,106,0.04)",
        border: "1px solid rgba(0,212,106,0.20)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h4
          className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest"
          style={{ color: "#00d46a" }}
        >
          <MapPin className="h-3 w-3" />
          Header · Localização
          {hasDefault && matchesDefault && (
            <span className="inline-flex items-center gap-0.5 normal-case font-normal text-[10px] tracking-normal"
              style={{ color: "#00d46a" }}>
              <Check className="h-2.5 w-2.5" />
              padrão
            </span>
          )}
        </h4>
        {canSave && !matchesDefault && (
          <button
            type="button"
            onClick={onSaveDefault}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium disabled:opacity-50"
            style={{
              background: "rgba(0,212,106,0.10)",
              color: "#00d46a",
              border: "1px solid rgba(0,212,106,0.25)",
            }}
          >
            <Save className="h-2.5 w-2.5" />
            {hasDefault ? "Atualizar padrão" : "Salvar como padrão"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={media.latitude}
          onChange={(e) => onChange({ ...media, latitude: e.target.value })}
          placeholder="Latitude (-23.5505)"
          className="w-full rounded-md px-3 py-2 text-xs outline-none"
          style={{
            background: "var(--surface-2)",
            border: "1px solid hsl(240 12% 16%)",
            color: "hsl(240 15% 90%)",
          }}
        />
        <input
          value={media.longitude}
          onChange={(e) => onChange({ ...media, longitude: e.target.value })}
          placeholder="Longitude (-46.6333)"
          className="w-full rounded-md px-3 py-2 text-xs outline-none"
          style={{
            background: "var(--surface-2)",
            border: "1px solid hsl(240 12% 16%)",
            color: "hsl(240 15% 90%)",
          }}
        />
      </div>
      <input
        value={media.name}
        onChange={(e) => onChange({ ...media, name: e.target.value })}
        placeholder="Nome do local (opcional)"
        className="w-full rounded-md px-3 py-2 text-xs outline-none"
        style={{
          background: "var(--surface-2)",
          border: "1px solid hsl(240 12% 16%)",
          color: "hsl(240 15% 90%)",
        }}
      />
      <input
        value={media.address}
        onChange={(e) => onChange({ ...media, address: e.target.value })}
        placeholder="Endereço (opcional)"
        className="w-full rounded-md px-3 py-2 text-xs outline-none"
        style={{
          background: "var(--surface-2)",
          border: "1px solid hsl(240 12% 16%)",
          color: "hsl(240 15% 90%)",
        }}
      />
    </div>
  );
}

// ─── Preview ───────────────────────────────────────────────────────────────

function TemplatePreview({
  tpl,
  variables,
  media,
}: {
  tpl: MetaTemplate;
  variables: Record<string, string>;
  media: MediaState;
}) {
  const headerComp = tpl.components?.find((c) => c.type === "HEADER");
  const headerFormat = headerComp?.format?.toUpperCase();
  const headerText = headerFormat === "TEXT" ? renderText(headerComp?.text, variables) : "";
  const bodyText = renderText(tpl.components?.find((c) => c.type === "BODY")?.text, variables);
  const footerText = tpl.components?.find((c) => c.type === "FOOTER")?.text;
  const buttons = tpl.components?.find((c) => c.type === "BUTTONS")?.buttons ?? [];

  return (
    <div
      className="mx-auto max-w-md rounded-2xl p-3 shadow-sm"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-default)",
        borderBottomLeftRadius: 6,
        color: "hsl(240 15% 92%)",
      }}
    >
      {/* Preview do header de mídia */}
      {headerFormat === "IMAGE" && (
        <div
          className="mb-2 overflow-hidden rounded-lg"
          style={{ background: "rgba(255,255,255,0.04)", aspectRatio: "16/9" }}
        >
          {media.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media.url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px]" style={{ color: "hsl(240 8% 44%)" }}>
              📷 imagem aparecerá aqui
            </div>
          )}
        </div>
      )}
      {headerFormat === "VIDEO" && (
        <div
          className="mb-2 flex items-center justify-center rounded-lg text-[11px]"
          style={{ background: "rgba(0,0,0,0.4)", aspectRatio: "16/9", color: "hsl(240 15% 70%)" }}
        >
          🎬 {media.url ? "Vídeo" : "vídeo aparecerá aqui"}
        </div>
      )}
      {headerFormat === "DOCUMENT" && (
        <div
          className="mb-2 flex items-center gap-2 rounded-lg p-2"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          <FileText className="h-5 w-5" style={{ color: "hsl(240 8% 60%)" }} />
          <span className="text-[11px]" style={{ color: "hsl(240 15% 80%)" }}>
            {media.filename || "documento.pdf"}
          </span>
        </div>
      )}
      {headerFormat === "LOCATION" && (
        <div
          className="mb-2 flex items-center gap-2 rounded-lg p-2"
          style={{ background: "rgba(0,212,106,0.06)" }}
        >
          <MapPin className="h-5 w-5" style={{ color: "#00d46a" }} />
          <span className="text-[11px]" style={{ color: "hsl(240 15% 80%)" }}>
            {media.name || `${media.latitude || "?"}, ${media.longitude || "?"}`}
          </span>
        </div>
      )}
      {headerText && (
        <div className="mb-2 text-sm font-medium" style={{ color: "#00d46a" }}>
          {headerText}
        </div>
      )}
      {bodyText && <p className="whitespace-pre-wrap text-sm">{bodyText}</p>}
      {footerText && (
        <div className="mt-2 text-[10px]" style={{ color: "hsl(240 8% 44%)" }}>
          {footerText}
        </div>
      )}
      {buttons.length > 0 && (
        <div className="mt-3 space-y-1">
          {buttons.map((b, i) => (
            <div
              key={i}
              className="rounded-md px-3 py-1.5 text-center text-xs font-medium"
              style={{
                background: "rgba(0,212,106,0.08)",
                color: "#00d46a",
                border: "1px solid rgba(0,212,106,0.2)",
              }}
            >
              {b.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── utils ──────────────────────────────────────────────────────────────────

function getBodyText(tpl: MetaTemplate): string {
  return tpl.components?.find((c) => c.type === "BODY")?.text ?? "";
}

function extractVariables(tpl: MetaTemplate): string[] {
  const rx = /\{\{\s*(\d+)\s*\}\}/g;
  const set = new Set<string>();
  (tpl.components ?? []).forEach((c) => {
    if (!c.text) return;
    // Header de mídia (IMAGE/VIDEO/DOC) não tem {{N}}; o input é o
    // próprio URL — não conta como variável de texto.
    if (c.type === "HEADER" && c.format && c.format.toUpperCase() !== "TEXT") return;
    let m;
    while ((m = rx.exec(c.text)) !== null) set.add(m[1]);
  });
  return Array.from(set).sort((a, b) => Number(a) - Number(b));
}

function renderText(text: string | undefined, variables: Record<string, string>): string {
  if (!text) return "";
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, k) => variables[k] || `{{${k}}}`);
}

// buildMetaComponents — converte os inputs do user no payload exato que
// a Meta espera. Cada formato de header tem seu próprio shape:
//
// TEXT:     { type: "header", parameters: [{ type: "text", text: "..." }] }
// IMAGE:    { type: "header", parameters: [{ type: "image", image: { link: "..." } }] }
// VIDEO:    { type: "header", parameters: [{ type: "video", video: { link: "..." } }] }
// DOCUMENT: { type: "header", parameters: [{ type: "document", document: { link, filename? } }] }
// LOCATION: { type: "header", parameters: [{ type: "location", location: { latitude, longitude, name?, address? } }] }
//
// BODY:     { type: "body", parameters: [{ type: "text", text: "..." }, ...] }
//
// Header sem variável (TEXT estático) e sem mídia não vai no array.
function buildMetaComponents(
  tpl: MetaTemplate,
  variables: Record<string, string>,
  media: MediaState,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  const headerComp = tpl.components?.find((c) => c.type === "HEADER");
  if (headerComp) {
    const fmt = (headerComp.format || "TEXT").toUpperCase();

    if (fmt === "TEXT" && headerComp.text) {
      const headerVars = (headerComp.text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) =>
        m.replace(/[{}\s]/g, ""),
      );
      if (headerVars.length > 0) {
        out.push({
          type: "header",
          parameters: headerVars.map((k) => ({ type: "text", text: variables[k] ?? "" })),
        });
      }
    } else if (fmt === "IMAGE" && media.url.trim()) {
      out.push({
        type: "header",
        parameters: [{ type: "image", image: { link: media.url.trim() } }],
      });
    } else if (fmt === "VIDEO" && media.url.trim()) {
      out.push({
        type: "header",
        parameters: [{ type: "video", video: { link: media.url.trim() } }],
      });
    } else if (fmt === "DOCUMENT" && media.url.trim()) {
      const doc: Record<string, string> = { link: media.url.trim() };
      if (media.filename.trim()) doc.filename = media.filename.trim();
      out.push({
        type: "header",
        parameters: [{ type: "document", document: doc }],
      });
    } else if (fmt === "LOCATION" && media.latitude.trim() && media.longitude.trim()) {
      const loc: Record<string, unknown> = {
        latitude: parseFloat(media.latitude),
        longitude: parseFloat(media.longitude),
      };
      if (media.name.trim()) loc.name = media.name.trim();
      if (media.address.trim()) loc.address = media.address.trim();
      out.push({
        type: "header",
        parameters: [{ type: "location", location: loc }],
      });
    }
  }

  const bodyComp = tpl.components?.find((c) => c.type === "BODY");
  if (bodyComp?.text) {
    const bodyVars = (bodyComp.text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) =>
      m.replace(/[{}\s]/g, ""),
    );
    if (bodyVars.length > 0) {
      out.push({
        type: "body",
        parameters: bodyVars.map((k) => ({ type: "text", text: variables[k] ?? "" })),
      });
    }
  }
  return out;
}
