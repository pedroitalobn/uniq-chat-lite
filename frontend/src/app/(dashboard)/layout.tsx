import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { LayoutClient } from "./LayoutClient";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <WorkspaceProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <LayoutClient>{children}</LayoutClient>
      </div>
    </WorkspaceProvider>
  );
}
