"use client";

import { useEffect, useState, useRef } from "react";
import { instancesApi } from "@/lib/api";
import { getSession } from "next-auth/react";
import { X, RefreshCw, QrCode, CheckCircle2, Smartphone, Copy, Check } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface Props {
  instanceId: string;
  onClose: () => void;
  onConnected?: () => void;
}

type Mode = "qr" | "pairing";

export function QRCodeModal({ instanceId, onClose, onConnected }: Props) {
  const [mode, setMode] = useState<Mode>("qr");

  // QR state
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Pairing code state
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState("");
  const [copied, setCopied] = useState(false);

  // Shared
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const markConnected = () => {
    setConnected(true);
    onConnected?.();
    setTimeout(onClose, 2000);
  };

  // Poll instance status as a reliable fallback
  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await instancesApi.status(instanceId);
        if (res.data.status === "connected") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          markConnected();
        }
      } catch { /* ignore */ }
    }, 2000);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // Fetch QR code
  const fetchQR = async () => {
    setLoading(true);
    setError("");
    setQrCode(null);
    try {
      const res = await instancesApi.getQR(instanceId);
      if (res.data.message?.includes("conectada")) {
        markConnected();
      } else {
        setQrCode(res.data.qr);
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Erro ao obter QR Code";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Open authenticated WebSocket for real-time events
  const openWebSocket = async () => {
    wsRef.current?.close();
    const session = await getSession();
    const token = (session?.accessToken as string) || "";
    const base = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").replace(/^http/, "ws");
    const url = `${base}/instances/${instanceId}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "status" && msg.data?.status === "connected") {
          markConnected();
        }
        if (msg.type === "qr" && msg.data?.qr) {
          setQrCode(msg.data.qr);
        }
      } catch { /* ignore */ }
    };
  };

  // On mount: fetch QR, open WS, start polling
  useEffect(() => {
    if (mode !== "qr") return;
    fetchQR();
    openWebSocket();
    startPolling();
    return () => {
      wsRef.current?.close();
      stopPolling();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, instanceId]);

  // Start polling when switching to pairing mode too
  useEffect(() => {
    if (mode !== "pairing") return;
    startPolling();
    openWebSocket();
    return () => {
      wsRef.current?.close();
      stopPolling();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, instanceId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      stopPolling();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPairingCode = async () => {
    if (!phone.trim()) {
      setPairingError("Informe o número com DDI (ex: 5511999999999)");
      return;
    }
    setPairingLoading(true);
    setPairingError("");
    setPairingCode("");
    try {
      const res = await instancesApi.getPairingCode(instanceId, phone.trim());
      setPairingCode(res.data.code);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Erro ao obter código";
      setPairingError(msg);
    } finally {
      setPairingLoading(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(pairingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-fade-in-up"
        style={{
          background: "hsl(240 18% 6%)",
          border: "1px solid hsl(240 12% 14%)",
          boxShadow: "0 0 0 1px hsl(240 12% 14%), 0 32px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}
            >
              <QrCode className="w-4 h-4" style={{ color: "var(--green)" }} />
            </div>
            <h2 className="text-base font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
              Conectar WhatsApp
            </h2>
          </div>
          <button
            onClick={onClose}
            className="transition-colors"
            style={{ color: "hsl(240 8% 38%)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode tabs */}
        {!connected && (
          <div className="flex rounded-xl p-0.5 mb-5" style={{ background: "hsl(240 12% 10%)" }}>
            {(["qr", "pairing"] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex-1 text-xs font-semibold py-1.5 rounded-lg transition-all"
                style={mode === m
                  ? { background: "hsl(240 12% 18%)", color: "hsl(240 15% 90%)" }
                  : { color: "hsl(240 8% 40%)" }
                }
              >
                {m === "qr" ? "QR Code" : "Código de Pareamento"}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col items-center gap-4">
          {/* Connected state */}
          {connected ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}
              >
                <CheckCircle2 className="w-8 h-8" style={{ color: "var(--green)" }} />
              </div>
              <p className="font-semibold" style={{ color: "hsl(240 15% 93%)" }}>WhatsApp conectado!</p>
              <p className="text-xs text-center" style={{ color: "hsl(240 8% 46%)" }}>Fechando automaticamente...</p>
            </div>

          ) : mode === "qr" ? (
            /* ── QR mode ── */
            loading ? (
              <div
                className="w-56 h-56 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <RefreshCw className="w-7 h-7 animate-spin" style={{ color: "hsl(240 8% 38%)" }} />
              </div>
            ) : error ? (
              <div
                className="w-full rounded-xl p-4 text-center"
                style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}
              >
                <p className="text-sm mb-3" style={{ color: "#f87171" }}>{error}</p>
                <button
                  onClick={fetchQR}
                  className="text-xs transition-colors"
                  style={{ color: "hsl(240 8% 46%)" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 15% 80%)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 46%)")}
                >
                  Tentar novamente
                </button>
              </div>
            ) : qrCode ? (
              <>
                <div
                  className="p-3 rounded-2xl"
                  style={{ background: "#ffffff", boxShadow: "0 0 0 1px rgba(0,212,106,0.2), 0 8px 32px rgba(0,0,0,0.4)" }}
                >
                  <QRCodeSVG value={qrCode} size={200} />
                </div>
                <p className="text-xs text-center leading-relaxed" style={{ color: "hsl(240 8% 46%)" }}>
                  Abra o WhatsApp → Dispositivos Vinculados → Vincular dispositivo
                </p>
                <button
                  onClick={fetchQR}
                  className="flex items-center gap-1.5 text-xs transition-colors"
                  style={{ color: "hsl(240 8% 38%)" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}
                >
                  <RefreshCw className="w-3 h-3" />
                  Atualizar QR Code
                </button>
              </>
            ) : null

          ) : (
            /* ── Pairing code mode ── */
            <div className="w-full space-y-4">
              <div className="rounded-xl p-3 text-xs leading-relaxed"
                style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.12)", color: "hsl(240 8% 56%)" }}>
                <p className="font-semibold mb-1" style={{ color: "#60a5fa" }}>Como usar:</p>
                <p>1. Informe seu número com DDI</p>
                <p>2. Clique em Gerar Código</p>
                <p>3. No WhatsApp: Dispositivos Vinculados → Vincular com número de telefone</p>
                <p>4. Digite o código de 8 dígitos exibido</p>
              </div>

              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 48%)" }}>
                  Número (com DDI, sem + ou espaços)
                </label>
                <div className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid hsl(240 12% 16%)" }}>
                  <Smartphone className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(240 8% 38%)" }} />
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, ""))}
                    placeholder="5511999999999"
                    className="flex-1 bg-transparent text-sm outline-none"
                    style={{ color: "hsl(240 15% 90%)" }}
                    onKeyDown={e => e.key === "Enter" && requestPairingCode()}
                  />
                </div>
              </div>

              {pairingCode ? (
                <div className="space-y-3">
                  <div className="rounded-xl p-4 text-center"
                    style={{ background: "rgba(0,212,106,0.06)", border: "1px solid rgba(0,212,106,0.2)" }}>
                    <p className="text-xs mb-2" style={{ color: "hsl(240 8% 48%)" }}>Código de pareamento</p>
                    <p className="text-3xl font-bold font-mono tracking-[0.2em]" style={{ color: "var(--green)" }}>
                      {pairingCode}
                    </p>
                    <p className="text-[10px] mt-2" style={{ color: "hsl(240 8% 38%)" }}>
                      Digite este código no WhatsApp → Dispositivos Vinculados
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={copyCode}
                      className="flex items-center justify-center gap-1.5 flex-1 text-xs py-2 rounded-xl transition-all"
                      style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.15)", color: "#60a5fa" }}
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copiado" : "Copiar"}
                    </button>
                    <button
                      onClick={() => { setPairingCode(""); requestPairingCode(); }}
                      className="flex-1 text-xs py-2 rounded-xl transition-all"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid hsl(240 12% 15%)", color: "hsl(240 8% 46%)" }}
                    >
                      Novo código
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {pairingError && (
                    <p className="text-xs text-center" style={{ color: "#f87171" }}>{pairingError}</p>
                  )}
                  <button
                    onClick={requestPairingCode}
                    disabled={pairingLoading || !phone.trim()}
                    className="w-full text-sm font-semibold py-2.5 rounded-xl transition-all disabled:opacity-40"
                    style={{ background: "var(--green)", color: "#03170a" }}
                    onMouseEnter={e => !pairingLoading && (e.currentTarget.style.filter = "brightness(1.1)")}
                    onMouseLeave={e => (e.currentTarget.style.filter = "none")}
                  >
                    {pairingLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Gerando código...
                      </span>
                    ) : "Gerar Código"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
