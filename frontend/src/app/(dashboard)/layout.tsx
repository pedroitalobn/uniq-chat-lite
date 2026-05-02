import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { LayoutClient } from "./LayoutClient";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { WorkspacePermissionsProvider } from "@/contexts/WorkspacePermissionsContext";
import { PresenceProvider } from "@/contexts/PresenceProvider";
import { UniqAIIslandProvider } from "@/components/uniq-ai/island-context";
import { UniqAIIsland } from "@/components/uniq-ai/dynamic-island";
import { AmbientAIPanel } from "@/components/uniq-ai/ambient-panel";

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
          <UniqAIIslandProvider>
            <div className="flex h-screen overflow-hidden">
              <Sidebar />
              <LayoutClient>{children}</LayoutClient>
            </div>
            <UniqAIIsland />
            <AmbientAIPanel />
            <BottomNav />
            <CommandPalette />
          </UniqAIIslandProvider>
        </PresenceProvider>
      </WorkspacePermissionsProvider>
    </WorkspaceProvider>
  );
}
