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
      login: (callback: (response: { authResponse?: { accessToken: string; code?: string } }) => void, config: { config_id: string; redirect_uri: string }) => void;
    };
    fbAsyncInit: () => void;
  }
}

interface Props {
  className?: string;
}

export function WABAConnectButton({ className }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const fbLoaded = useRef(false);

  const callbackMutation = useMutation({
    mutationFn: async (code: string) => {
      const result = await wabaApi.callback(code);
      return result;
    },
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
    if (fbLoaded.current) return;
    fbLoaded.current = true;

    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    script.setAttribute("crossorigin", "anonymous");
    script.onload = () => {
      window.fbAsyncInit = () => {
        window.FB.init({
          appId: process.env.NEXT_PUBLIC_META_APP_ID || "",
          cookie: true,
          xfbml: true,
          version: "v21.0",
        });
      };
    };
    document.body.appendChild(script);

    return () => {
      const existingScript = document.querySelector('script[src*="connect.facebook.net"]');
      if (existingScript) {
        existingScript.remove();
      }
    };
  }, []);

  const handleConnect = async () => {
    setStatus("loading");
    setErrorMessage("");

    try {
      const { auth_url } = await wabaApi.getAuthURL();
      const authUrl = auth_url;

      if (!window.FB) {
        setStatus("error");
        setErrorMessage("Facebook SDK não carregou. Recarregue a página.");
        return;
      }

      window.FB.login(
        (response) => {
          if (response.authResponse?.code) {
            callbackMutation.mutate(response.authResponse.code);
          } else {
            setStatus("error");
            setErrorMessage("Autorização cancelada pelo usuário");
          }
        },
        {
          config_id: authUrl.match(/config_id=(\d+)/)?.[1] || "",
          redirect_uri: window.location.origin + "/v1/waba/callback",
        }
      );
    } catch (error) {
      setStatus("error");
      const err = error as Error;
      setErrorMessage(err.message || "Erro ao obter URL de autorização");
      toast.error(err.message || "Erro ao conectar");
    }
  };

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
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
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