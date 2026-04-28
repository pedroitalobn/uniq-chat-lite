import { NextRequest, NextResponse } from "next/server";
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
    const params = new URLSearchParams({
      error: error,
      description: errorDescription || "",
    });
    return NextResponse.redirect(`${origin}/instances?waba_error=1&${params}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/instances?waba_error=missing_code`);
  }

  // Pega JWT do NextAuth pra autenticar contra o backend (Authorization: Bearer)
  const session = await auth();
  const accessToken = (session as { accessToken?: string } | null)?.accessToken;
  if (!accessToken) {
    return NextResponse.redirect(`${origin}/login?next=/instances`);
  }

  // API_URL aponta pro backend dentro da rede docker (http://uniqchat-backend:8080)
  // Em dev local cai pro NEXT_PUBLIC_API_URL externo.
  const apiBase =
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://uniqchat-backend:8080";

  try {
    const res = await fetch(`${apiBase}/v1/waba/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        code,
        instance_id: stateInstanceId || undefined,
      }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      console.error("[waba/callback] backend error:", res.status, bodyText);
      const params = new URLSearchParams({
        error: "exchange_failed",
        status: String(res.status),
        body: bodyText.slice(0, 300),
      });
      return NextResponse.redirect(`${origin}/instances?waba_error=1&${params}`);
    }

    let data: { instance_id?: string; next_step?: string } = {};
    try {
      data = JSON.parse(bodyText);
    } catch {
      // not JSON — ignore
    }
    const instanceId = data.instance_id || stateInstanceId;

    if (instanceId) {
      const next = data.next_step || "";
      return NextResponse.redirect(
        `${origin}/instances/${instanceId}/waba?waba_connected=1&next=${next}`,
      );
    }

    return NextResponse.redirect(`${origin}/instances?waba_connected=1`);
  } catch (err) {
    console.error("[waba/callback] network error:", err);
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(
      `${origin}/instances?waba_error=network&detail=${encodeURIComponent(msg)}`,
    );
  }
}
