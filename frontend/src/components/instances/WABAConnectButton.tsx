"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import wabaApi from "@/lib/waba-api";
import { Loader2, MessageCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    FB?: {
      init: (config: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
      getLoginStatus: (cb: (response: unknown) => void) => void;
    };
    fbAsyncInit?: () => void;
  }
}

interface Props {
  className?: string;
}

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || "";
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID || "";

interface SessionInfo {
  type: "WA_EMBEDDED_SIGNUP";
  event: "FINISH" | "CANCEL" | "ERROR";
  data?: {
    phone_number_id?: string;
    waba_id?: string;
    business_id?: string;
  };
}

export function WABAConnectButton({ className }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const popupRef = useRef<Window | null>(null);
  const sessionInfoRef = useRef<SessionInfo | null>(null);

  const callbackMutation = useMutation({
    mutationFn: async (code: string) => wabaApi.callback(code),
    onSuccess: () => {
      setStatus("success");
      toast.success("WhatsApp API conectado com sucesso!");
      router.push("/inbox");
    },
    onError: (error: Error) => {
      setStatus("error");
      setErrorMessage(error.message || "Erro ao conectar WhatsApp API");
      toast.error(error.message || "Erro ao conectar");
    },
  });

  // Listener postMessage do popup Meta — entrega session info (waba_id, phone_number_id)
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com" &&
        event.origin !== "https://business.facebook.com"
      ) {
        return;
      }
      try {
        const payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (payload?.type === "WA_EMBEDDED_SIGNUP") {
          sessionInfoRef.current = payload as SessionInfo;
        }
      } catch {
        // not json — ignore
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleConnect = () => {
    setStatus("loading");
    setErrorMessage("");
    sessionInfoRef.current = null;

    if (!META_APP_ID || !META_CONFIG_ID) {
      setStatus("error");
      setErrorMessage("Envs NEXT_PUBLIC_META_APP_ID / CONFIG_ID não configuradas no build.");
      return;
    }

    const redirectUri = `${window.location.origin}/api/waba/callback`;
    const extras = encodeURIComponent(
      JSON.stringify({
        setup: {},
        featureType: "",
        sessionInfoVersion: "3",
        version: "v4",
      }),
    );

    const authUrl =
      `https://www.facebook.com/v18.0/dialog/oauth` +
      `?client_id=${META_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&config_id=${META_CONFIG_ID}` +
      `&override_default_response_type=true` +
      `&display=popup` +
      `&extras=${extras}`;

    // Popup centralizado — dimensões explícitas evitam fallback pra aba
    const w = 600;
    const h = 750;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;

    // Cross-browser popup window:
    // - Chrome/Edge 100+: precisam de popup=yes (sem isso ignoram dimensões e abrem aba)
    // - Firefox: só com width+height já abre como popup
    // - Safari: width+height funcionam; flags toolbar/menubar/location confundem Safari
    //   e fazem abrir como "tool window" (menor e sem chrome). Removidas.
    // - Mobile: SEMPRE abre como aba (não existe popup mini em mobile, é limitação do OS)
    const features = `popup=yes,width=${w},height=${h},left=${left},top=${top}`;
    const popup = window.open(authUrl, "waba_embedded_signup", features);

    if (!popup) {
      setStatus("error");
      setErrorMessage("Popup bloqueado pelo navegador. Permita popups e tente de novo.");
      return;
    }
    popupRef.current = popup;

    // Polling pra detectar fechamento — se fechou sem session info, foi cancelado
    const interval = setInterval(() => {
      if (popup.closed) {
        clearInterval(interval);
        const session = sessionInfoRef.current;
        if (session?.event === "FINISH" && session.data) {
          // session info chegou via postMessage — agora pega o code via redirect-back
          // No flow Embedded Signup v4, o code chega no redirect_uri (callback page).
          // Por enquanto consideramos sucesso visual e o backend trata via callback.
          setStatus("success");
          toast.success(
            `WABA conectada! waba_id=${session.data.waba_id?.slice(0, 8)}…`,
          );
        } else if (status === "loading") {
          setStatus("error");
          setErrorMessage("Autorização cancelada ou janela fechada.");
        }
      }
    }, 500);
  };

  // Carrega FB SDK só pra ter disponível se quiser usar getLoginStatus depois
  useEffect(() => {
    if (!META_APP_ID) return;
    if (document.querySelector('script[src*="connect.facebook.net"]')) return;

    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: META_APP_ID,
        cookie: true,
        xfbml: false,
        version: "v21.0",
      });
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    document.body.appendChild(script);
  }, []);

  return (
    <div className={className}>
      <button
        onClick={handleConnect}
        disabled={status === "loading"}
        className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-[#0088ff] hover:bg-[#0077ee] text-white font-medium rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === "loading" ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Conectando...</span>
          </>
        ) : status === "success" ? (
          <>
            <MessageCircle className="w-5 h-5" />
            <span>Conectado!</span>
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            <span>Conectar WhatsApp API</span>
          </>
        )}
      </button>

      {status === "error" && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-800 font-medium">Erro na conexão</p>
            <p className="text-red-600 text-sm mt-1">{errorMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
}
