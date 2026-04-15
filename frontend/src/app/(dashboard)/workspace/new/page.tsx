"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export default function NewWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const createMutation = useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await axios.post(`${API_BASE}/workspaces`, data, { withCredentials: true });
      return res.data;
    },
    onSuccess: (data) => {
      router.push(`/workspace/${data.id}`);
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || "Erro ao criar workspace");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ name: name.trim() });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "hsl(240 20% 4%)" }}>
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-6">Criar Workspace</h1>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Nome do Workspace</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Minha Empresa"
              className="w-full px-4 py-3 rounded-lg bg-[var(--surface)] border border-[var(--surface-border)] text-white placeholder-gray-500 focus:outline-none focus:border-[var(--green)]"
              required
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="w-full py-3 rounded-lg font-medium transition-all"
            style={{ background: "var(--green)", color: "#000" }}
          >
            {createMutation.isPending ? "Criando..." : "Criar Workspace"}
          </button>
        </form>
      </div>
    </div>
  );
}