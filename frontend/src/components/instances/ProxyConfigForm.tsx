"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { proxyApi } from "@/lib/api";
import { Globe, Loader2, Info, Shield, ArrowUpRight } from "lucide-react";

// Proxy é configurado no nível do Server. A instância só mostra, em modo
// read-only, qual proxy ela está usando (via o server vinculado).
// Pra alterar, o usuário vai até a página do server.

const COUNTRY_FLAGS: Record<string, string> = {
  br: "🇧🇷", us: "🇺🇸", gb: "🇬🇧", ar: "🇦🇷", co: "🇨🇴", mx: "🇲🇽",
  es: "🇪🇸", de: "🇩🇪", fr: "🇫🇷", it: "🇮🇹", jp: "🇯🇵", cn: "🇨🇳",
};

interface Props {
  instanceId: string;
}

interface ProxyView {
  has_proxy: boolean;
  server_id?: string;
  server_name?: string;
  proxy_id?: string;
  name?: string;
  country?: string;
  type?: string;
  is_platform?: boolean;
  managed?: boolean;
  host?: string;
  port?: number;
  username?: string;
  note?: string;
}

export default function ProxyConfigForm({ instanceId }: Props) {
  const { data, isLoading } = useQuery<ProxyView>({
    queryKey: ["instance-proxy", instanceId],
    queryFn: () => proxyApi.get(instanceId).then((r) => r.data),
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500 p-6">
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando proxy…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-sm text-zinc-500 p-6">Sem dados de proxy.</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800">
        <Info className="w-4 h-4 mt-0.5 text-zinc-500 shrink-0" />
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          O proxy é definido no <strong>server</strong> ao qual a instância está
          vinculada. Todas as instâncias do mesmo server compartilham o mesmo
          proxy. Pra alterar, vá até a página do server.
        </div>
      </div>

      {data.has_proxy ? (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="p-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {data.name || "Proxy"}
                  </span>
                  {data.country && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                      {COUNTRY_FLAGS[data.country] || "🌐"} {data.country.toUpperCase()}
                    </span>
                  )}
                  {data.is_platform ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300">
                      Plataforma
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">
                      Custom
                    </span>
                  )}
                </div>
                <div className="text-sm text-zinc-500 mt-1">
                  {data.is_platform ? (
                    "Gerenciado pela plataforma — detalhes ocultos"
                  ) : (
                    <span className="font-mono text-xs">
                      {data.type || "http"}://{data.username ? `${data.username}@` : ""}
                      {data.host}:{data.port}
                    </span>
                  )}
                </div>
                {data.server_name && (
                  <div className="text-xs text-zinc-500 mt-2 flex items-center gap-1">
                    Configurado no server:{" "}
                    <Link
                      href={`/servers/${data.server_id}`}
                      className="text-emerald-600 dark:text-emerald-500 hover:underline inline-flex items-center gap-0.5"
                    >
                      {data.server_name}
                      <ArrowUpRight className="w-3 h-3" />
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 text-center">
          <Globe className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Conexão direta (sem proxy)
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            {data.note || "O server dessa instância não tem proxy configurado."}
          </div>
          {data.server_id && (
            <Link
              href={`/servers/${data.server_id}`}
              className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500 hover:underline mt-3"
            >
              Configurar proxy no server
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
