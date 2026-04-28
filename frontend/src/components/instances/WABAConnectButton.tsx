"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import wabaApi from "@/lib/waba-api";
import { Loader2, MessageCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    FB: {
      init: (config: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
      login: (
        callback: (response: { authResponse?: { accessToken?: string; code?: string } }) => void,
        config: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

interface Props {
  className?: string;
}

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || "";
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID || "";

export function WABAConnectButton({ className }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [sdkReady, setSdkReady] = useState(false);
  const sdkLoading = useRef(false);

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

  useEffect(() => {
    if (sdkLoading.current) return;
    sdkLoading.current = true;

    if (!META_APP_ID) {
      setErrorMessage(
        "NEXT_PUBLIC_META_APP_ID não configurado no build do frontend.",
      );
      return;
    }

    // fbAsyncInit precisa estar definido ANTES do script carregar
    window.fbAsyncInit = () => {
      window.FB.init({
        appId: META_APP_ID,
        cookie: true,
        xfbml: true,
        version: "v21.0",
      });
      setSdkReady(true);
    };

    if (document.querySelector('script[src*="connect.facebook.net"]')) {
      // já carregado em outro mount — apenas marca como pronto se FB existe
      if (window.FB) setSdkReady(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    document.body.appendChild(script);
  }, []);

  const handleConnect = () => {
    setStatus("loading");
    setErrorMessage("");

    if (!window.FB || !sdkReady) {
      setStatus("error");
      setErrorMessage("Facebook SDK ainda carregando. Aguarde 2s e tente novamente.");
      return;
    }

    if (!META_CONFIG_ID) {
      setStatus("error");
      setErrorMessage("NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID não configurado.");
      return;
    }

    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (code) {
          callbackMutation.mutate(code);
        } else {
          setStatus("error");
          setErrorMessage("Autorização cancelada pelo usuário");
        }
      },
      {
        config_id: META_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        display: "popup",
        auth_type: "rerequest",
        extras: {
          setup: {},
          featureType: "",
          sessionInfoVersion: "3",
          version: "v4",
        },
      },
    );
  };

  return (
    <div className={className}>
      <button
        onClick={handleConnect}
        disabled={status === "loading" || !sdkReady}
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
            <span>{sdkReady ? "Conectar WhatsApp API" : "Carregando SDK..."}</span>
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
