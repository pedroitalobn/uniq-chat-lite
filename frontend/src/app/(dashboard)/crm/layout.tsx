"use client";

import { CRMNav } from "@/components/crm/CRMNav";

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col md:flex-row gap-3 md:gap-4">
      <CRMNav />
      <div className="flex-1 min-w-0 min-h-0 overflow-auto">
        {children}
      </div>
    </div>
  );
}
