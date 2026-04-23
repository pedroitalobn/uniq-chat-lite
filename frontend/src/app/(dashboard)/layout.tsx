import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { LayoutClient } from "./LayoutClient";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { WorkspacePermissionsProvider } from "@/contexts/WorkspacePermissionsContext";
import { PresenceProvider } from "@/contexts/PresenceProvider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <WorkspaceProvider>
      <WorkspacePermissionsProvider>
        <PresenceProvider>
          <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar />
            <LayoutClient>{children}</LayoutClient>
          </div>
        </PresenceProvider>
      </WorkspacePermissionsProvider>
    </WorkspaceProvider>
  );
}
