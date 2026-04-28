import { NextRequest } from "next/server";
import { auth } from "@/auth";

// Recebe o redirect da Meta após Embedded Signup com ?code=&state=
// Encaminha pro backend trocar code por access_token + atualizar/criar
// a WABAInstance, depois redireciona pro app com instance_id ou erro.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const searchParams = url.searchParams;

  // Origem real (atrás do proxy do Dokploy/Traefik). req.url retorna localhost
  // dentro do container — usa x-forwarded-host ou NEXTAUTH_URL como fallback.
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") || "https";
  const origin = fwdHost
    ? `${fwdProto}://${fwdHost}`
    : process.env.NEXTAUTH_URL || url.origin;

  const code = searchParams.get("code");
  const state = searchParams.get("state") || "";
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // state vem como "instance:<uuid>" — extrai instanceId pra atualizar
  // a WABA existente em vez de criar uma nova.
  const stateInstanceId = state.startsWith("instance:") ? state.slice(9) : "";

  if (error) {
    return htmlBridge({
      type: "error",
      message: errorDescription || error,
      target: `/instances?waba_error=1&error=${encodeURIComponent(error)}`,
      origin,
    });
  }

  if (!code) {
    return htmlBridge({
      type: "error",
      message: "code ausente",
      target: `/instances?waba_error=missing_code`,
      origin,
    });
  }

  // Pega JWT do NextAuth pra autenticar contra o backend (Authorization: Bearer)
  const session = await auth();
  const accessToken = (session as { accessToken?: string } | null)?.accessToken;
  if (!accessToken) {
    return htmlBridge({
      type: "error",
      message: "Sessão expirada",
      target: `/login?next=/instances`,
      origin,
    });
  }

  // Tenta primeiro o internal docker (http://uniqchat-backend:8080) e
  // cai pro público (https://api.uniq.chat) se DNS interno falhar.
  // Algumas configs de Dokploy/Compose não compartilham network entre
  // serviços, então o fallback é importante.
  const candidates = [
    process.env.API_URL,
    process.env.NEXT_PUBLIC_API_URL,
    "https://api.uniq.chat",
    "http://uniqchat-backend:8080",
  ].filter((u): u is string => !!u);

  const fetchOpts = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      code,
      instance_id: stateInstanceId || undefined,
      // Manda o redirect_uri exato usado no popup pra exchange não falhar
      // por mismatch entre origem real e FRONTEND_URL do .env.
      redirect_uri: `${origin}/api/waba/callback`,
    }),
  };

  let res: Response | null = null;
  let lastErr: unknown = null;
  for (const base of candidates) {
    try {
      res = await fetch(`${base}/v1/waba/callback`, fetchOpts);
      console.log("[waba/callback] reached backend at", base, res.status);
      break;
    } catch (e) {
      lastErr = e;
      console.warn(
        "[waba/callback] failed",
        base,
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (!res) {
    const msg = lastErr instanceof Error ? lastErr.message : "all backends unreachable";
    return htmlBridge({
      type: "error",
      message: `Backend inalcançável: ${msg}`,
      target: `/instances?waba_error=network&detail=${encodeURIComponent(msg)}`,
      origin,
    });
  }

  try {

    const bodyText = await res.text();
    if (!res.ok) {
      console.error("[waba/callback] backend error:", res.status, bodyText);
      const params = new URLSearchParams({
        error: "exchange_failed",
        status: String(res.status),
        body: bodyText.slice(0, 300),
      });
      return htmlBridge({
        type: "error",
        message: `Backend ${res.status}: ${bodyText.slice(0, 200)}`,
        target: `/instances?waba_error=1&${params}`,
        origin,
      });
    }

    let data: { instance_id?: string; next_step?: string } = {};
    try {
      data = JSON.parse(bodyText);
    } catch {
      // not JSON — ignore
    }
    const instanceId = data.instance_id || stateInstanceId;

    const next = data.next_step || "";
    const target = instanceId
      ? `/instances/${instanceId}/waba?waba_connected=1&next=${next}`
      : `/instances?waba_connected=1`;

    // Renderiza HTML que avisa janela-pai e fecha popup. Se aberto sem
    // opener (não-popup), redireciona normal.
    return htmlBridge({
      type: "success",
      instanceId: instanceId || "",
      next,
      target,
      origin,
    });
  } catch (err) {
    console.error("[waba/callback] network error:", err);
    const msg = err instanceof Error ? err.message : "unknown";
    return htmlBridge({
      type: "error",
      message: msg,
      target: `/instances?waba_error=network&detail=${encodeURIComponent(msg)}`,
      origin,
    });
  }
}

interface BridgePayload {
  type: "success" | "error";
  instanceId?: string;
  next?: string;
  message?: string;
  target: string;
  origin: string;
}

function htmlBridge(p: BridgePayload): Response {
  const payload = JSON.stringify({
    type: "WABA_CALLBACK",
    status: p.type,
    instance_id: p.instanceId || null,
    next_step: p.next || null,
    error: p.message || null,
  });

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>WhatsApp API</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0a0a0f; color: #e5e5e5;
    display: flex; align-items: center; justify-content: center; height: 100vh;
    margin: 0; text-align: center; padding: 24px; }
  .box { max-width: 360px; }
  h1 { font-size: 16px; font-weight: 500; margin: 0 0 8px; }
  p { font-size: 13px; color: #888; margin: 0 0 16px; }
  a { color: #0088ff; text-decoration: none; font-size: 13px; }
</style></head>
<body><div class="box">
<h1>${p.type === "success" ? "Conectado!" : "Falha na conexão"}</h1>
<p>${p.type === "success" ? "Você pode fechar esta janela." : (p.message || "Tente novamente.")}</p>
<a href="${p.origin}${p.target}" id="back">Voltar para o app</a>
</div>
<script>
(function() {
  var data = ${payload};
  var target = ${JSON.stringify(p.origin + p.target)};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(data, "*");
      setTimeout(function(){ window.close(); }, 400);
    } else {
      window.location.replace(target);
    }
  } catch (e) {
    window.location.replace(target);
  }
})();
</script></body></html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
