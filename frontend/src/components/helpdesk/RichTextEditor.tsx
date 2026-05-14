"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Youtube from "@tiptap/extension-youtube";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold, Italic, Strikethrough, List, ListOrdered, Quote, Code,
  Heading1, Heading2, Heading3, Image as ImageIcon, Link as LinkIcon,
  Video, Code2, Undo2, Redo2, Pilcrow,
} from "lucide-react";
import { parseVideoUrl } from "./VideoPlayer";

export function RichTextEditor({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: "rounded-lg max-w-full" },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "underline text-[var(--green)]",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Youtube.configure({
        controls: true,
        nocookie: true,
        HTMLAttributes: { class: "rounded-lg w-full aspect-video" },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Escreva o conteúdo do artigo… use a barra acima pra formatar.",
      }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-invert max-w-none focus:outline-none min-h-[400px] px-5 py-4 " +
          "[&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-2 " +
          "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 " +
          "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 " +
          "[&_p]:my-2 [&_p]:leading-relaxed " +
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 " +
          "[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-strong)] [&_blockquote]:pl-3 [&_blockquote]:italic " +
          "[&_code]:bg-[var(--border-subtle)] [&_code]:px-1 [&_code]:rounded [&_code]:text-[0.9em] " +
          "[&_pre]:bg-[rgba(0,0,0,0.45)] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto " +
          "[&_iframe]:rounded-lg [&_iframe]:my-3 [&_iframe]:aspect-video [&_iframe]:w-full " +
          "[&_video]:rounded-lg [&_video]:my-3 [&_img]:rounded-lg [&_img]:my-3",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) {
    return (
      <div
        className="rounded-xl min-h-[400px] flex items-center justify-center"
        style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-3)" }}
      >
        Carregando editor…
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--border-default)",
      }}
    >
      <Toolbar editor={editor} />
      <EditorContent editor={editor} style={{ color: "var(--text-1)" }} />
    </div>
  );
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const insertImage = () => {
    const url = window.prompt("Cole a URL da imagem (.png/.jpg/.webp):");
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  };

  const insertVideo = () => {
    const url = window.prompt("Cole a URL do vídeo (YouTube, Vimeo ou MP4/WebM):");
    if (!url) return;
    const vs = parseVideoUrl(url);
    if (!vs) {
      window.alert("URL não reconhecida. Use YouTube, Vimeo ou link direto de vídeo (.mp4/.webm).");
      return;
    }
    if (vs.type === "youtube") {
      editor.commands.setYoutubeVideo({ src: url, width: 640, height: 360 });
      return;
    }
    if (vs.type === "vimeo") {
      const iframe = `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:14px;margin:16px 0"><iframe src="https://player.vimeo.com/video/${vs.id}?byline=0&portrait=0" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" allowfullscreen allow="autoplay;encrypted-media"></iframe></div>`;
      editor.chain().focus().insertContent(iframe).run();
      return;
    }
    if (vs.type === "html5") {
      const video = `<video controls playsinline style="width:100%;border-radius:14px;margin:16px 0"><source src="${vs.src}" type="${vs.mimeType}"></video>`;
      editor.chain().focus().insertContent(video).run();
    }
  };

  const insertLink = () => {
    const prev = editor.getAttributes("link").href;
    const url = window.prompt("URL do link (deixe vazio pra remover):", prev || "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const insertHTML = () => {
    const html = window.prompt("Cole o HTML embed (iframe, áudio, vídeo etc):");
    if (!html) return;
    editor.chain().focus().insertContent(html).run();
  };

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 px-2 py-2"
      style={{
        background: "rgba(0,0,0,0.20)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Heading 1">
        <Heading1 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2">
        <Heading2 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3">
        <Heading3 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().setParagraph().run()} active={editor.isActive("paragraph")} title="Parágrafo">
        <Pilcrow className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Negrito (Ctrl+B)">
        <Bold className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Itálico (Ctrl+I)">
        <Italic className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Tachado">
        <Strikethrough className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Lista">
        <List className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Lista numerada">
        <ListOrdered className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Citação">
        <Quote className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} title="Bloco de código">
        <Code className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton onClick={insertLink} active={editor.isActive("link")} title="Link">
        <LinkIcon className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={insertImage} title="Imagem">
        <ImageIcon className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={insertVideo} title="Vídeo (YouTube, Vimeo, MP4)">
        <Video className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={insertHTML} title="HTML embed (iframe / áudio / vídeo)">
        <Code2 className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Desfazer">
        <Undo2 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Refazer">
        <Redo2 className="w-4 h-4" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  children, onClick, active, disabled, title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      style={{
        width: 28,
        height: 28,
        background: active ? "rgba(37, 99, 235,0.14)" : "transparent",
        color: active ? "#2563EB" : "var(--text-2)",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (!active) e.currentTarget.style.background = "var(--border-subtle)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <span
      className="mx-1 inline-block"
      style={{ width: 1, height: 18, background: "var(--border-default)" }}
    />
  );
}
