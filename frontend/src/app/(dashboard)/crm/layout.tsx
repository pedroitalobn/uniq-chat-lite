"use client";

import { CRMNav } from "@/components/crm/CRMNav";

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col md:flex-row gap-3 md:gap-6">
      <CRMNav />
      <div
        className="flex-1 min-w-0 rounded-2xl overflow-hidden"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
      >
        {children}
      </div>
    </div>
  );
}
