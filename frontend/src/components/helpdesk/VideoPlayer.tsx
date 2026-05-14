"use client";

import { useRef, useEffect, useCallback, type CSSProperties } from "react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";

type VideoSource =
  | { type: "youtube"; id: string }
  | { type: "vimeo"; id: string }
  | { type: "html5"; src: string; mimeType?: string };

function parseVideoUrl(url: string): VideoSource | null {
  try {
    const u = new URL(url);
    if (
      u.hostname === "www.youtube.com" ||
      u.hostname === "youtube.com" ||
      u.hostname === "m.youtube.com"
    ) {
      const id = u.searchParams.get("v");
      if (id) return { type: "youtube", id };
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      if (id) return { type: "youtube", id };
    }
    if (
      u.hostname === "www.vimeo.com" ||
      u.hostname === "vimeo.com" ||
      u.hostname === "player.vimeo.com"
    ) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length > 0) return { type: "vimeo", id: parts[parts.length - 1] };
    }
    if (/\.(mp4|webm|ogg|ogv)(\?|$)/i.test(url)) {
      const ext = url.match(/\.(mp4|webm|ogg|ogv)/i)?.[1]?.toLowerCase() ?? "mp4";
      const mime: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", ogg: "video/ogg", ogv: "video/ogg" };
      return { type: "html5", src: url, mimeType: mime[ext] ?? "video/mp4" };
    }
  } catch {}
  return null;
}

export { parseVideoUrl, type VideoSource };

export function VideoPlayer({
  url,
  style,
  className,
}: {
  url: string;
  style?: CSSProperties;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const plyrRef = useRef<Plyr | null>(null);

  const init = useCallback(() => {
    if (!videoRef.current || plyrRef.current) return;
    const vs = parseVideoUrl(url);
    if (!vs) return;
    const instance = new Plyr(videoRef.current, {
      youtube: { noCookie: true },
      vimeo: { byline: false, portrait: false },
    });
    if (vs.type === "youtube") {
      instance.source = { type: "video", sources: [{ provider: "youtube", src: vs.id }] };
    } else if (vs.type === "vimeo") {
      instance.source = { type: "video", sources: [{ provider: "vimeo", src: vs.id }] };
    } else {
      instance.source = { type: "video", sources: [{ src: vs.src, type: vs.mimeType ?? "video/mp4" }] };
    }
    plyrRef.current = instance;
  }, [url]);

  useEffect(() => {
    init();
    return () => {
      plyrRef.current?.destroy();
      plyrRef.current = null;
    };
  }, [init]);

  return (
    <div
      className={className}
      style={{
        borderRadius: 14,
        overflow: "hidden",
        "--plyr-color-main": "#2563EB",
        ...style,
      } as CSSProperties}
    >
      <video ref={videoRef} playsInline />
    </div>
  );
}
