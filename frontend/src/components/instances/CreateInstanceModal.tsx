"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { instancesApi, serversApi, channelsApi, tiktokApi } from "@/lib/api";
import { X, Server, Key, Check, Eye, EyeOff, User, Lock, Loader2, ExternalLink } from "lucide-react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import type { Server as ServerType, ChannelInfo } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  workspaceId?: string;
}

const FALLBACK_CHANNELS = (isSuperAdmin: boolean): ChannelInfo[] => [
  { id: "whatsapp",     label: "WhatsApp Business", color: "#25d366", description: "Não-oficial via QR ou código de pareamento (whatsmeow)", available: true },
  { id: "waba",         label: "WhatsApp API",      color: "#0088ff", description: "Cloud API oficial Meta — templates HSM + Embedded Signup", available: isSuperAdmin },
  { id: "instagram",    label: "Instagram Profile", color: "#e1306c", description: isSuperAdmin ? "Login não-oficial — DMs, scraping, follow/unfollow" : "Em breve", available: isSuperAdmin || false },
  { id: "instagram_api", label: "Instagram API",    color: "#cc2366", description: "Em breve — API oficial Meta (Messaging Graph API)", available: false },
  { id: "tiktok",       label: "TikTok",            color: "#ff0050", description: isSuperAdmin ? "DMs, scraping, follow/unfollow" : "Em breve", available: isSuperAdmin || false },
  { id: "facebook",     label: "Facebook",          color: "#1877f2", description: isSuperAdmin ? "Facebook Messenger" : "Em breve", available: isSuperAdmin || false },
  { id: "telegram",     label: "Telegram",          color: "#229ed9", description: isSuperAdmin ? "Bots via Telegram API" : "Em breve", available: isSuperAdmin || false },
  { id: "linkedin",     label: "LinkedIn",          color: "#0a66c2", description: isSuperAdmin ? "Mensagens via LinkedIn API" : "Em breve", available: isSuperAdmin || false },
  { id: "kwai",         label: "Kwai",              color: "#ff6600", description: isSuperAdmin ? "Mensagens via Kwai" : "Em breve", available: isSuperAdmin || false },
];

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  whatsapp: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  ),
  instagram_api: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  ),
  telegram: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  ),
  linkedin: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z"/>
    </svg>
  ),
  kwai: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.5 13.5l-5-3v-5l5 3v5zm-9-8l4 2.4V15l-4-2.4V7.5z"/>
    </svg>
  ),
  waba: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  ),
};

export function CreateInstanceModal({ open, onClose, onCreated, workspaceId }: Props) {
  const [step, setStep] = useState<"channel" | "config">("channel");
  const [selectedChannel, setSelectedChannel] = useState<string>("whatsapp");
  const [name, setName] = useState("");
  const [serverId, setServerId] = useState("");
  const [customToken, setCustomToken] = useState("");
  const [igUsername, setIgUsername] = useState("");
  const [igPassword, setIgPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<{ api_path: string; challenge_type?: string; options?: string[] } | null>(null);
  const [challengeCode, setChallengeCode] = useState("");
  const [pendingInstagramInstanceId, setPendingInstagramInstanceId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const isSocial = selectedChannel === "instagram" || selectedChannel === "tiktok";
  const isWABA = selectedChannel === "waba";
  // Canais baseados em API oficial da Meta não precisam de server/proxy.
  // Todos os outros canais (WhatsApp não-oficial, Instagram, TikTok, etc.) precisam.
  const requiresServer = !isWABA && selectedChannel !== "instagram_api";

  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "super_admin";
  const isBeta = session?.user?.is_beta === true || isSuperAdmin;

  const { data: channels } = useQuery<ChannelInfo[]>({
    queryKey: ["channels"],
    queryFn: () => channelsApi.list().then((r) => r.data),
    enabled: open,
    staleTime: Infinity,
  });

  const availableChannels = channels || FALLBACK_CHANNELS(isBeta);

  // Servers filtrados por workspace — sem o param o backend devolve servers
  // de TODOS os workspaces do user, e o usuário poderia atachar server
  // de outro workspace na instância.
  const { data: servers = [] } = useQuery<ServerType[]>({
    queryKey: ["servers", workspaceId],
    queryFn: () => serversApi.list(workspaceId).then((r) => r.data),
    enabled: open && step === "config",
  });

  const handleCreate = async () => {
    if (isWABA) {
      if (!name.trim()) {
        toast.error("Dê um nome à instância antes de continuar");
        return;
      }
      setCreating(true);
      try {
        // Cria shell de instância WABA em estado disconnected — fica na lista
        // mesmo se user desistir do Embedded Signup. O Connect na página da
        // instância completa o fluxo (atualiza esta mesma instância).
        const resp = await instancesApi.create(
          name.trim(),
          "waba",
          undefined,
          undefined,
          workspaceId,
        );
        const newId = resp?.data?.id as string | undefined;
        if (!newId) throw new Error("falha ao criar instância");
        toast.success("Instância criada — agora conecte ao WhatsApp API");
        reset();
        onCreated();
        onClose();
        window.location.href = `/instances/${newId}/waba`;
      } catch (err) {
        const e = err as { response?: { data?: { error?: string } }; message?: string };
        toast.error(e?.response?.data?.error || e?.message || "Erro ao criar instância");
      } finally {
        setCreating(false);
      }
      return;
    }

    if (!name.trim()) return;
    if (isSocial && (!igUsername.trim() || !igPassword.trim())) {
      toast.error("Username e password são obrigatórios para este canal");
      return;
    }
    if (requiresServer && !serverId) {
      toast.error("Selecione um server para esta instância (necessário para aplicar o proxy)");
      return;
    }

    setCreating(true);
    try {
      // First create the instance
      const createResp = await instancesApi.create(
        name.trim(),
        selectedChannel,
        serverId || undefined,
        customToken.trim() || undefined,
        workspaceId
      );

      // Then, for social channels, register/connect account where required
      if (selectedChannel === "tiktok") {
        const accountData = { username: igUsername.trim().toLowerCase(), password: igPassword.trim() };
        await tiktokApi.createAccount(accountData);
      }

      if (selectedChannel === "instagram") {
        const createdId = createResp?.data?.id as string | undefined;
        if (!createdId) {
          throw new Error("falha ao criar instância Instagram");
        }

        setLoggingIn(true);
        const loginResp = await instancesApi.instagramLogin(createdId, {
          username: igUsername.trim().toLowerCase(),
          password: igPassword,
        });
        setLoggingIn(false);

        const loginData = loginResp?.data as { status?: string; api_path?: string; challenge_type?: string; options?: string[] };
        if (loginData?.status === "challenge_required") {
          setPendingInstagramInstanceId(createdId);
          setChallenge({
            api_path: loginData.api_path || "",
            challenge_type: loginData.challenge_type,
            options: loginData.options,
          });
          toast.info(loginData.api_path ? "Código de verificação necessário para concluir criação" : "Instagram exigiu verificação no app/email antes de concluir");
          return;
        }
      }

      toast.success("Instância criada com sucesso!");
      reset();
      onCreated();
      onClose();
    } catch (err: unknown) {
      type AxiosErr = { response?: { data?: { error?: string } }; code?: string; message?: string };
      const e = err as AxiosErr;
      const msg =
        e?.response?.data?.error ||
        (e?.code === "ERR_NETWORK" || e?.code === "ERR_FAILED"
          ? "Falha na conexão com o servidor. Verifique o servidor/proxy da instância."
          : e?.message || "Erro ao criar instância");
      toast.error(msg);
    } finally {
      setCreating(false);
      setLoggingIn(false);
    }
  };

  const reset = () => {
    setStep("channel");
    setSelectedChannel("whatsapp");
    setName("");
    setServerId("");
    setCustomToken("");
    setIgUsername("");
    setIgPassword("");
    setShowPassword(false);
    setChallenge(null);
    setChallengeCode("");
    setPendingInstagramInstanceId(null);
  };

  const handleClose = () => { reset(); onClose(); };

  if (!open) return null;

  const ch = availableChannels.find((c) => c.id === selectedChannel);

  if (loggingIn) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center" style={{ background: "hsl(240 18% 4% / 0.95)", backdropFilter: "blur(12px)" }}>
        <div className="flex flex-col items-center gap-6">
          {/* Aura animada */}
          <div className="relative flex items-center justify-center">
            <div className="absolute w-32 h-32 rounded-full animate-ping" style={{ background: "radial-gradient(circle, rgba(225,48,108,0.3) 0%, transparent 70%)", animationDuration: "1.5s" }} />
            <div className="absolute w-24 h-24 rounded-full animate-ping" style={{ background: "radial-gradient(circle, rgba(225,48,108,0.2) 0%, transparent 70%)", animationDuration: "1.5s", animationDelay: "0.3s" }} />
            <div className="absolute w-20 h-20 rounded-full" style={{ background: "radial-gradient(circle, rgba(225,48,108,0.15) 0%, transparent 70%)", animation: "pulse 2s ease-in-out infinite" }} />
            <div
              className="relative w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl"
              style={{ background: "linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)", boxShadow: "0 0 40px rgba(225,48,108,0.5)" }}
            >
              {CHANNEL_ICONS.instagram}
            </div>
          </div>

          <div className="text-center space-y-1">
            <p className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Conectando ao Instagram</p>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Autenticando <span className="font-medium" style={{ color: "#e1306c" }}>@{igUsername}</span>…</p>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>Isso pode levar até 30 segundos</p>
          </div>

          {/* Barra de progresso indeterminada */}
          <div className="w-48 h-0.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
            <div
              className="h-full rounded-full"
              style={{
                background: "linear-gradient(90deg, #833ab4, #fd1d1d, #fcb045)",
                animation: "slide-indeterminate 1.8s ease-in-out infinite",
                width: "40%",
              }}
            />
          </div>
        </div>

        <style>{`
          @keyframes slide-indeterminate {
            0% { transform: translateX(-250%); }
            100% { transform: translateX(500%); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: "var(--surface-overlay)" }}
        onClick={handleClose}
      />
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl animate-fade-in-up overflow-y-auto max-h-[90vh]"
        style={{
          background: "hsl(240 18% 6%)",
          border: "1px solid hsl(240 12% 14%)",
          boxShadow: "0 0 0 1px hsl(240 12% 14%), 0 32px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div>
            <h2 className="text-base font-medium" style={{ color: "hsl(240 15% 93%)" }}>
              Nova Instância
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 42%)" }}>
              {step === "channel" ? "Escolha o canal de mensagens" : `Canal: ${ch?.label}`}
            </p>
          </div>
          <button onClick={handleClose} style={{ color: "hsl(240 8% 38%)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1: Channel selector — grid 4×2 desktop, 1col mobile */}
        {step === "channel" && (
          <div className="px-6 pb-6 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {availableChannels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => {
                  if (!channel.available) return;
                  setSelectedChannel(channel.id);
                  setStep("config");
                }}
                disabled={!channel.available}
                title={channel.description}
                className="relative flex flex-col items-center justify-center gap-2 px-3 py-5 rounded-xl transition-all duration-150"
                style={{
                  background: selectedChannel === channel.id
                    ? `${channel.color}12`
                    : "var(--surface-2)",
                  border: selectedChannel === channel.id
                    ? `1px solid ${channel.color}40`
                    : "1px solid var(--border-default)",
                  opacity: channel.available ? 1 : 0.4,
                  cursor: channel.available ? "pointer" : "not-allowed",
                }}
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ background: `${channel.color}15`, color: channel.color }}>
                  {CHANNEL_ICONS[channel.id]}
                </div>
                <span className="text-xs font-medium text-center leading-tight" style={{ color: "hsl(240 15% 90%)" }}>
                  {channel.label}
                </span>
                {(channel.id === "instagram" || channel.id === "tiktok") && channel.available && (
                  <span className="absolute top-1.5 right-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.25)" }}>
                    Beta
                  </span>
                )}
                {!channel.available && (
                  <span className="absolute top-1.5 right-1.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ background: "var(--surface-3)", color: "hsl(240 8% 60%)" }}>
                    Em breve
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Config */}
        {step === "config" && ch && (
          <form
            onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
            className="px-6 pb-6 space-y-4"
          >
            {/* Channel badge */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: `${ch.color}10`, border: `1px solid ${ch.color}25` }}>
              <span style={{ color: ch.color }}>{CHANNEL_ICONS[ch.id]}</span>
              <span className="text-xs font-medium" style={{ color: ch.color }}>{ch.label}</span>
              <button type="button" className="ml-auto text-xs underline"
                style={{ color: "hsl(240 8% 42%)" }}
                onClick={() => setStep("channel")}>
                trocar
              </button>
            </div>

            {/* Name */}
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>
                Nome da instância
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`ex: ${ch.label} Suporte`}
                className="input-field w-full"
                autoFocus
                maxLength={80}
              />
            </div>

            {/* Instagram challenge verification */}
            {selectedChannel === "instagram" && challenge && (
              <>
                <div className="border-t pt-3" style={{ borderColor: "hsl(240 12% 13%)" }}>
                  <p className="text-xs font-medium mb-2" style={{ color: "#e1306c" }}>
                    Verificação do Instagram ({challenge.challenge_type || "código"})
                  </p>
                  <p className="text-[11px]" style={{ color: "hsl(240 8% 50%)" }}>
                    Digite o código recebido para concluir a criação da instância.
                  </p>
                </div>
                {challenge.api_path ? (
                  <>
                    <div>
                      <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>
                        Código de verificação
                      </label>
                      <input
                        type="text"
                        value={challengeCode}
                        onChange={(e) => setChallengeCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="000000"
                        className="input-field w-full text-center tracking-[0.3em]"
                        maxLength={6}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={creating || challengeCode.length < 6}
                      className="btn-primary w-full py-2.5 text-sm disabled:opacity-40"
                      style={{ background: ch?.color || "#e1306c", color: "white" }}
                      onClick={async () => {
                        try {
                          setCreating(true);
                          if (!pendingInstagramInstanceId) throw new Error("instância pendente não encontrada");
                          await instancesApi.instagramChallenge(pendingInstagramInstanceId, { api_path: challenge.api_path, code: challengeCode });
                          toast.success("Instância Instagram criada e conectada!");
                          reset();
                          onCreated();
                          onClose();
                        } catch (err: unknown) {
                          const msg =
                            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                            "Erro ao validar código";
                          toast.error(msg);
                        } finally {
                          setCreating(false);
                        }
                      }}
                    >
                      {creating ? "Validando..." : "Validar código e concluir"}
                    </button>
                  </>
                ) : (
                  <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}>
                    <p className="text-xs" style={{ color: "hsl(240 8% 58%)" }}>
                      O Instagram pediu confirmação de segurança fora da API. Acesse o app/site do Instagram dessa conta,
                      conclua a verificação e tente novamente.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Instagram/TikTok credentials */}
            {isSocial && !challenge && (
              <>
                <div className="border-t pt-3" style={{ borderColor: "hsl(240 12% 13%)" }}>
                  <p className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: ch.color }}>
                    <User className="w-3 h-3" />
                    Credenciais da conta {ch.label}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>
                    Username
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "hsl(240 8% 35%)" }} />
                    <input
                      type="text"
                      value={igUsername}
                      onChange={(e) => setIgUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ""))}
                      placeholder="username"
                      className="input-field w-full pl-9"
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>
                    Senha
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "hsl(240 8% 35%)" }} />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={igPassword}
                      onChange={(e) => setIgPassword(e.target.value)}
                      placeholder="••••••••"
                      className="input-field w-full pl-9 pr-10"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                      style={{ color: "hsl(240 8% 40%)" }}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Server — obrigatório para todos exceto WABA/instagram_api (APIs oficiais Meta) */}
            {requiresServer && (
              <div>
                <label className="text-xs font-medium flex items-center gap-1.5 mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>
                  <Server className="w-3 h-3" /> Server <span className="text-red-400">*</span>
                </label>
                {servers.length === 0 ? (
                  <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", color: "hsl(240 8% 60%)" }}>
                    Nenhum server disponível neste workspace.{" "}
                    <a href="/servers" target="_blank" rel="noopener" className="underline" style={{ color: "#f87171" }}>
                      Crie um server
                    </a>{" "}
                    com proxy configurado antes de criar esta instância.
                  </div>
                ) : (
                  <select value={serverId} onChange={(e) => setServerId(e.target.value)} className="input-field w-full">
                    <option value="">— selecione um server —</option>
                    {servers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.slug})</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Custom token (optional) — não aplicável para WABA (token vem do OAuth) */}
            {!isWABA && (
              <div>
                <label className="text-xs font-medium flex items-center gap-1.5 mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>
                  <Key className="w-3 h-3" /> Token personalizado (opcional)
                </label>
                <input
                  type="text"
                  value={customToken}
                  onChange={(e) => setCustomToken(e.target.value)}
                  placeholder="Gerado automaticamente se omitido"
                  className="input-field w-full font-mono text-xs"
                  maxLength={128}
                />
              </div>
            )}

            {isWABA && (
              <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(0,136,255,0.08)", border: "1px solid rgba(0,136,255,0.25)", color: "hsl(240 8% 70%)" }}>
                Após criar, você será redirecionado para o Embedded Signup da Meta.
                Lá você seleciona/cria sua conta WhatsApp Business e número de telefone.
                Token e credenciais são geridos pela Meta — não há configuração manual aqui.
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setStep("channel")} className="btn-ghost flex-1 py-2.5 text-sm">
                Voltar
              </button>
              {!challenge && (
                <button
                  type="submit"
                  disabled={!name.trim() || creating || (isSocial && (!igUsername.trim() || !igPassword.trim())) || (requiresServer && !serverId)}
                  className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ background: ch.color, color: ch.id === "whatsapp" ? "#03170a" : "white" }}
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>{creating ? "Criando..." : "Criar instância"}</span>
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
