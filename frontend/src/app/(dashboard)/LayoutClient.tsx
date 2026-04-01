"use client";

import { usePathname } from "next/navigation";

export function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullWidth = pathname === "/inbox";

  if (isFullWidth) {
    return (
      <main className="flex-1 overflow-hidden bg-dot-grid">
        <div className="px-4 sm:px-6 py-6 lg:py-8 pt-16 lg:pt-8 h-full overflow-y-auto">
          {children}
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-hidden bg-dot-grid">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 lg:py-8 pt-16 lg:pt-8 h-full overflow-y-auto">
        {children}
      </div>
    </main>
  );
}
