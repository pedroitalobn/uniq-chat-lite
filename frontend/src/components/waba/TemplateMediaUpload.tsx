"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { wabaApi } from "@/lib/api";

// Botão "subir mídia" reutilizável pros fluxos de template WABA
// (TemplatePicker do inbox · WABA test send · Create campaign).
//
// Evita o user precisar de S3/Cloudinary próprio: faz upload direto
// pro MinIO da Uniq, devolve URL pública pronta pro Meta. Quando
// templateName+templateLanguage vêm, persiste como default na mesma
// request (o backend faz upsert).
//
// API mínima: instanceId + onUploaded(url). Aceita imagem/vídeo/PDF
// — limite de 16MB (mesmo da Cloud API). Mostra spinner e ✓ verde
// quando termina.
export function TemplateMediaUpload({
  instanceId,
  templateName,
  templateLanguage,
  format,
  onUploaded,
  saveAsDefault,
  size = "sm",
}: {
  instanceId: string;
  templateName?: string;
  templateLanguage?: string;
  format?: "IMAGE" | "VIDEO" | "DOCUMENT";
  onUploaded: (url: string) => void;
  saveAsDefault?: boolean;
  size?: "sm" | "md";
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [justUploaded, setJustUploaded] = useState(false);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const r = await wabaApi.uploadTemplateMedia(
        instanceId,
        file,
        saveAsDefault && templateName && templateLanguage
          ? { template_name: templateName, template_language: templateLanguage }
          : undefined,
      );
      return r.data;
    },
    onSuccess: (data) => {
      onUploaded(data.url);
      setJustUploaded(true);
      setTimeout(() => setJustUploaded(false), 2500);
      toast.success(
        data.default_saved
          ? "Mídia subida e salva como padrão pra próxima vez"
          : "Mídia subida — URL preenchida",
      );
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.response?.data?.hint || "Falha ao subir mídia";
      toast.error(msg);
    },
  });

  // Accept dinâmico baseado no format do template — UX previne o user
  // de subir um vídeo num template de imagem (Meta rejeita por mismatch).
  const accept = (() => {
    switch (format) {
      case "IMAGE":
        return "image/jpeg,image/png,image/webp";
      case "VIDEO":
        return "video/mp4,video/3gpp";
      case "DOCUMENT":
        return "application/pdf";
      default:
        return "image/*,video/*,application/pdf";
    }
  })();

  const padding = size === "md" ? "px-3 py-2" : "px-2 py-1.5";
  const iconSize = size === "md" ? "w-4 h-4" : "w-3 h-3";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
        className={`inline-flex items-center gap-1 rounded-md text-xs font-medium ${padding} disabled:opacity-50 transition-colors`}
        style={
          justUploaded
            ? {
                background: "rgba(37, 99, 235,0.10)",
                color: "#2563EB",
                border: "1px solid rgba(37, 99, 235,0.25)",
              }
            : {
                background: "rgba(96,165,250,0.10)",
                color: "#60a5fa",
                border: "1px solid rgba(96,165,250,0.25)",
              }
        }
        title="Subir arquivo do seu computador. A  Qchat hospeda e devolve a URL pra Meta."
      >
        {upload.isPending ? (
          <Loader2 className={`${iconSize} animate-spin`} />
        ) : justUploaded ? (
          <Check className={iconSize} />
        ) : (
          <Upload className={iconSize} />
        )}
        {upload.isPending
          ? "Enviando..."
          : justUploaded
          ? "Enviado"
          : "Subir arquivo"}
      </button>
    </>
  );
}

// Variante simples de "trocar URL" — mostra um chip discreto com a
// preview da URL atual + botão pra limpar. Útil quando o user já
// subiu o arquivo e quer só ver/remover.
export function TemplateMediaPreview({
  url,
  onClear,
}: {
  url: string;
  onClear?: () => void;
}) {
  if (!url) return null;
  const filename = url.split("/").pop() || url;
  const isImg = /\.(jpe?g|png|webp|gif)$/i.test(url);
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[10px]"
      style={{
        background: "rgba(37, 99, 235,0.05)",
        border: "1px solid rgba(37, 99, 235,0.20)",
        color: "#2563EB",
      }}
    >
      {isImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="w-5 h-5 rounded object-cover flex-shrink-0" />
      ) : (
        <Check className="w-3 h-3 flex-shrink-0" />
      )}
      <span className="font-mono truncate max-w-[160px]" title={url}>
        {filename}
      </span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="p-0.5 rounded hover:bg-red-500/20 flex-shrink-0"
          style={{ color: "#f87171" }}
          title="Limpar"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}
