"use client";

// Página pública do Preference Center. Acessada via link em mensagens
// outbound (LGPD). Sem auth — acesso por token opaco. Permite contato:
//   - Ver tópicos de comunicação do workspace
//   - Marcar/desmarcar opt-in por tópico
//   - Tópicos required (transacionais) ficam fixos (não podem desativar)

import { use, useEffect, useState } from "react";
import { Loader2, Check, AlertCircle, Mail } from "lucide-react";
import { Logo } from "@/components/Logo";

interface Topic {
  id: string;
  slug: string;
  name: string;
  description: string;
  is_required: boolean;
  opted_in: boolean;
}

export default function PreferencesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "";

  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/p/preferences/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setTopics(data.topics || []);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Não foi possível carregar suas preferências.");
        setLoading(false);
      });
  }, [apiBase, token]);

  const toggle = (id: string) => {
    setTopics((prev) => prev.map((t) => (t.id === id && !t.is_required ? { ...t, opted_in: !t.opted_in } : t)));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    const body: Record<string, boolean> = {};
    topics.forEach((t) => { body[t.id] = t.opted_in; });
    try {
      await fetch(`${apiBase}/p/preferences/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setSaved(true);
    } catch {
      setError("Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "hsl(240 20% 4%)" }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <Logo height={36} />
        </div>
        <div className="rounded-2xl p-6"
          style={{
            background: "hsl(240 18% 6%)",
            boxShadow: "0 0 0 1px hsl(240 12% 13%), 0 24px 64px rgba(0,0,0,0.5)",
          }}>
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-4 h-4" style={{ color: "var(--green)" }} />
            <h1 className="text-base font-medium" style={{ color: "var(--text-1)" }}>
              Suas preferências de comunicação
            </h1>
          </div>
          <p className="text-xs mb-5" style={{ color: "var(--text-3)" }}>
            Escolha quais tipos de mensagem você quer receber. As alterações têm efeito imediato.
          </p>

          {loading && (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg"
              style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)" }}>
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {!loading && !error && (
            <>
              <div className="space-y-2">
                {topics.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-start gap-3 p-3 rounded-lg cursor-pointer"
                    style={{
                      background: t.opted_in ? "var(--green-soft)" : "var(--surface-3)",
                      border: `1px solid ${t.opted_in ? "var(--green-border)" : "var(--surface-border)"}`,
                      opacity: t.is_required ? 0.7 : 1,
                      cursor: t.is_required ? "default" : "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={t.opted_in}
                      disabled={t.is_required}
                      onChange={() => toggle(t.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text-1)" }}>
                        {t.name}
                        {t.is_required && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                            OBRIGATÓRIO
                          </span>
                        )}
                      </p>
                      {t.description && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{t.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>

              {saved ? (
                <div className="mt-4 flex items-center gap-2 text-xs justify-center"
                  style={{ color: "var(--green)" }}>
                  <Check className="w-4 h-4" /> Preferências salvas
                </div>
              ) : (
                <button
                  onClick={save}
                  disabled={saving}
                  className="w-full mt-5 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                  style={{ background: "var(--green)", color: "var(--green-fg)" }}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Salvar preferências
                </button>
              )}

              <p className="text-[10px] text-center mt-4" style={{ color: "var(--text-3)" }}>
                LGPD · você pode atualizar a qualquer momento usando este link.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
