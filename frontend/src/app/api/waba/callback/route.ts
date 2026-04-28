import { NextRequest, NextResponse } from "next/server";

// Recebe o redirect da Meta após Embedded Signup com ?code=...
// Encaminha o code pro backend trocar por access_token + criar a WABAInstance,
// depois redireciona pro app com instance_id ou erro.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorReason = searchParams.get("error_reason");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    const params = new URLSearchParams({
      error: error,
      reason: errorReason || "",
      description: errorDescription || "",
    });
    return NextResponse.redirect(`${origin}/instances?waba_error=1&${params}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/instances?waba_error=missing_code`);
  }

  // Chama o backend (server-to-server) pra trocar code por token
  const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "";
  const cookieHeader = req.headers.get("cookie") || "";

  try {
    const res = await fetch(`${apiBase}/v1/waba/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify({ code }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[waba/callback] backend error:", res.status, body);
      const params = new URLSearchParams({ error: "exchange_failed", body: body.slice(0, 200) });
      return NextResponse.redirect(`${origin}/instances?waba_error=1&${params}`);
    }

    const data = (await res.json()) as { instance?: { id: string }; next_step?: string };
    const instanceId = data.instance?.id;

    if (instanceId) {
      const next = data.next_step || "";
      return NextResponse.redirect(
        `${origin}/instances/${instanceId}/waba?waba_connected=1&next=${next}`,
      );
    }

    return NextResponse.redirect(`${origin}/instances?waba_connected=1`);
  } catch (err) {
    console.error("[waba/callback] network error:", err);
    return NextResponse.redirect(`${origin}/instances?waba_error=network`);
  }
}
