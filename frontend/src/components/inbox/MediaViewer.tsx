"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Download, ZoomIn, ZoomOut, RotateCw, Maximize2, FileText,
} from "lucide-react";
import { mediaApi } from "@/lib/api";

export interface MediaViewerSource {
  type: "image" | "video" | "audio" | "document";
  url: string;
  filename?: string;
  mimeType?: string;
  caption?: string;
  // mediaKey — quando vem do storage Hetzner, usamos o proxy /v1/media/download
  // ao invés de fetch direto (que esbarra em CORS do bucket).
  mediaKey?: string;
}

// MediaViewer — lightbox fullscreen pra inbox.
//   - Imagens: zoom (scroll/pinch), pan, rotação, download
//   - Vídeos: player nativo controles + fullscreen do navegador
//   - Áudios: player nativo (já fica inline na bubble; o viewer abre se
//     o user quiser fullscreen com waveform/info)
//   - Documentos: preview de PDF embutido, download pra outros tipos
//
// Fechado: ESC ou clique no backdrop.
export function MediaViewer({
  source,
  onClose,
}: {
  source: MediaViewerSource | null;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Reset transformações quando troca de mídia
  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  }, [source?.url]);

  // ESC fecha
  useEffect(() => {
    if (!source) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (source.type === "image") {
        if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(5, z + 0.25));
        if (e.key === "-" || e.key === "_") setZoom((z) => Math.max(0.25, z - 0.25));
        if (e.key === "0") {
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }
        if (e.key === "r" || e.key === "R") setRotation((r) => (r + 90) % 360);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [source, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (!source) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [source]);

  if (!source || typeof document === "undefined") return null;

  const onWheel = (e: React.WheelEvent) => {
    if (source.type !== "image") return;
    e.preventDefault();
    const delta = -e.deltaY * 0.005;
    setZoom((z) => Math.max(0.25, Math.min(5, z + delta)));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (source.type !== "image" || zoom <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  };
  const onMouseUp = () => setDragging(false);

  const downloadHandler = async () => {
    // Hetzner não retorna CORS no bucket; fetch direto falha.
    // Usa o proxy /v1/media/download que stream com Content-Disposition: attachment.
    try {
      if (!source.mediaKey) throw new Error("media sem key");
      const res = await mediaApi.download(source.mediaKey, source.filename);
      const blob = res.data as Blob;
      const objectURL = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectURL;
      a.download = source.filename || `media-${Date.now()}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectURL);
    } catch {
      // fallback: abre em nova aba (signed URL ainda funciona pra preview)
      window.open(source.url, "_blank");
    }
  };

  const isPDF = source.type === "document" && (source.mimeType?.includes("pdf") || source.filename?.toLowerCase().endsWith(".pdf"));

  const content = (
    <div className="fixed inset-0 z-[200] uniq-fade-in">
      {/* Backdrop — full-screen click target. Toda área que NÃO é a mídia
          em si fecha o viewer. Mais natural que ter que mirar no X. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="absolute inset-0"
        style={{
          background: "rgba(0,0,0,0.92)",
          backdropFilter: "blur(8px)",
          cursor: "zoom-out",
        }}
      />

      {/* Container do conteúdo — relative stack acima do backdrop. Cada
          filho usa stopPropagation pra capturar cliques sem fechar. */}
      <div className="relative z-10 flex h-full w-full flex-col pointer-events-none">
      {/* Header com toolbar */}
      <header
        className="flex items-center justify-between px-4 sm:px-6 py-3 flex-shrink-0 pointer-events-auto"
        style={{ borderBottom: "1px solid var(--border-default)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {source.filename && (
            <span className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>
              {source.filename}
            </span>
          )}
          {source.mimeType && (
            <span className="text-[10px] flex-shrink-0" style={{ color: "var(--text-3)" }}>
              {source.mimeType}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {source.type === "image" && (
            <>
              <ToolBtn onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} title="Zoom out (−)">
                <ZoomOut className="h-4 w-4" />
              </ToolBtn>
              <span className="text-xs tabular-nums px-2" style={{ color: "var(--text-2)" }}>
                {Math.round(zoom * 100)}%
              </span>
              <ToolBtn onClick={() => setZoom((z) => Math.min(5, z + 0.25))} title="Zoom in (+)">
                <ZoomIn className="h-4 w-4" />
              </ToolBtn>
              <ToolBtn onClick={() => setRotation((r) => (r + 90) % 360)} title="Girar 90° (R)">
                <RotateCw className="h-4 w-4" />
              </ToolBtn>
              <ToolBtn
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                  setRotation(0);
                }}
                title="Resetar (0)"
              >
                <Maximize2 className="h-4 w-4" />
              </ToolBtn>
              <Sep />
            </>
          )}
          <ToolBtn onClick={downloadHandler} title="Baixar">
            <Download className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn onClick={onClose} title="Fechar (Esc)" intent="close">
            <X className="h-4 w-4" />
          </ToolBtn>
        </div>
      </header>

      {/* Body — pointer-events:none deixa cliques na área "vazia" passarem
          pro backdrop. Apenas a mídia em si tem pointer-events:auto. */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden p-4 sm:p-8"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: source.type === "image" && zoom > 1 ? (dragging ? "grabbing" : "grab") : "default" }}
      >
      <div className="pointer-events-auto" onClick={(e) => e.stopPropagation()}>
        {source.type === "image" && (
          <img
            src={source.url}
            alt={source.filename || "imagem"}
            className="max-h-full max-w-full select-none transition-transform"
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transitionDuration: dragging ? "0ms" : "120ms",
            }}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          />
        )}

        {source.type === "video" && (
          <video
            src={source.url}
            controls
            autoPlay
            className="max-h-full max-w-full rounded-lg"
            style={{ background: "black" }}
            onClick={(e) => e.stopPropagation()}
          />
        )}

        {source.type === "audio" && (
          <div
            className="flex flex-col items-center gap-4 rounded-2xl px-8 py-10"
            style={{
              background: "var(--surface-solid)",
              border: "1px solid var(--border)",
              minWidth: 360,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex h-20 w-20 items-center justify-center rounded-full"
              style={{
                background: "rgba(0,212,106,0.1)",
                border: "1px solid rgba(0,212,106,0.25)",
              }}
            >
              <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="#00d46a" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.506-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            </div>
            <div className="text-center">
              <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
                {source.filename || "Mensagem de voz"}
              </div>
              {source.mimeType && (
                <div className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>
                  {source.mimeType}
                </div>
              )}
            </div>
             <audio src={source.url} controls autoPlay preload="auto" className="w-full" />
          </div>
        )}

        {source.type === "document" && (
          <>
            {isPDF ? (
              <iframe
                src={source.url}
                className="w-full h-full max-w-5xl rounded-lg"
                style={{ background: "white", minHeight: "70vh" }}
                title={source.filename || "Documento"}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div
                className="flex flex-col items-center gap-4 rounded-2xl px-10 py-12"
                style={{
                  background: "var(--surface-solid)",
                  border: "1px solid var(--border)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-2xl"
                  style={{
                    background: "rgba(96,165,250,0.1)",
                    border: "1px solid rgba(96,165,250,0.25)",
                    color: "#60a5fa",
                  }}
                >
                  <FileText className="h-8 w-8" />
                </div>
                <div className="text-center">
                  <div className="text-base font-medium" style={{ color: "var(--text-1)" }}>
                    {source.filename || "Documento"}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
                    Pré-visualização não disponível
                  </div>
                </div>
                <button
                  onClick={downloadHandler}
                  className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors"
                  style={{ background: "#00d46a", color: "#0a0a0f" }}
                >
                  <Download className="h-4 w-4" />
                  Baixar
                </button>
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {/* Caption (rodapé) */}
      {source.caption && (
        <footer
          className="flex-shrink-0 px-4 sm:px-6 py-3 text-center text-sm pointer-events-auto"
          style={{
            color: "hsl(240 15% 80%)",
            borderTop: "1px solid var(--border-default)",
            background: "var(--surface-overlay)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {source.caption}
        </footer>
      )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function ToolBtn({
  children,
  onClick,
  title,
  intent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  intent?: "close";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex items-center justify-center rounded-lg p-2 transition-colors"
      style={{
        color: intent === "close" ? "var(--text-1)" : "hsl(240 8% 65%)",
        background: "var(--surface-2)",
        border: "1px solid var(--border-default)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = intent === "close" ? "rgba(239,68,68,0.15)" : "var(--border-default)";
        e.currentTarget.style.color = intent === "close" ? "#f87171" : "hsl(240 15% 95%)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--surface-2)";
        e.currentTarget.style.color = intent === "close" ? "var(--text-1)" : "hsl(240 8% 65%)";
      }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px" style={{ background: "var(--surface-3)" }} />;
}
