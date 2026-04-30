"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DocsPageRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/api-docs"); }, [router]);
  return null;
}
