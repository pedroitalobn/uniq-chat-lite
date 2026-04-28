"use client";

// DEPRECATED — fluxo movido pro modal "Criar instância".
// Esta página redireciona pra /instances pra evitar criação direta sem
// shell-instance (que ficaria órfã se o user desistisse no Embedded Signup).

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DeprecatedNewWABAPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/instances?new=waba");
  }, [router]);
  return null;
}
