"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// /billing redireciona pra /settings?section=billing — billing é uma
// tab de Conta agora (consistência com tema do app + sem duplicação).
export default function BillingRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings?section=billing");
  }, [router]);
  return null;
}
