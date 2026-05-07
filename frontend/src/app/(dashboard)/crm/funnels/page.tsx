"use client";

// /crm/funnels — redirect pra /crm/properties (que agora hospeda
// funis, tags e campos personalizados num só lugar). Mantemos o
// arquivo pra não quebrar bookmarks/links antigos.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function FunnelsLegacyPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/crm/properties?tab=funnels");
  }, [router]);
  return null;
}
