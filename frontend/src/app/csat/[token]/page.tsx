"use client";

import { use, useState } from "react";
import { Star, Check, X, Loader2 } from "lucide-react";
import { csatApi } from "@/lib/api";

// Public, unauthenticated CSAT response page — opened via a tokenized link
// shared with the customer over the original channel (WhatsApp, Instagram, …).
// Lives outside the (dashboard) group so it has no sidebar / auth guard.
export default function CSATPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [rating, setRating] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<"form" | "done" | "error">("form");

  const submit = async () => {
    if (rating < 1 || rating > 5) return;
    setSubmitting(true);
    try {
      await csatApi.submitPublic(token, { rating, comment });
      setState("done");
    } catch {
      setState("error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 px-4 py-12 dark:from-zinc-950 dark:to-zinc-900">
      <div className="w-full max-w-md">
        {state === "form" && (
          <div className="rounded-2xl bg-white p-8 shadow-lg dark:bg-zinc-950">
            <h1 className="text-xl font-semibold">Como foi seu atendimento?</h1>
            <p className="mt-1 text-sm text-zinc-500">Sua avaliação nos ajuda a melhorar.</p>

            <div className="mt-6 flex items-center justify-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setRating(n)}
                  className="p-1.5 transition"
                  aria-label={`${n} estrelas`}
                  type="button"
                >
                  <Star
                    className={`h-10 w-10 transition ${
                      (hover || rating) >= n
                        ? "fill-amber-400 text-amber-400"
                        : "text-zinc-300 dark:text-zinc-700"
                    }`}
                  />
                </button>
              ))}
            </div>

            <textarea
              className="mt-6 w-full min-h-24 resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="Conte o que a gente pode melhorar (opcional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />

            <button
              onClick={submit}
              disabled={submitting || rating < 1}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Enviar avaliação
            </button>
          </div>
        )}

        {state === "done" && (
          <div className="rounded-2xl bg-white p-8 text-center shadow-lg dark:bg-zinc-950">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
              <Check className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-xl font-semibold">Obrigado!</h1>
            <p className="mt-1 text-sm text-zinc-500">Sua avaliação foi registrada. Pode fechar esta página.</p>
          </div>
        )}

        {state === "error" && (
          <div className="rounded-2xl bg-white p-8 text-center shadow-lg dark:bg-zinc-950">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-500">
              <X className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-xl font-semibold">Não foi possível registrar</h1>
            <p className="mt-1 text-sm text-zinc-500">
              O link pode ter expirado ou já foi respondido. Entre em contato com o atendente caso necessário.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
