import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/components/layout/Sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-hidden bg-dot-grid">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 lg:py-8 pt-16 lg:pt-8 h-full overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
