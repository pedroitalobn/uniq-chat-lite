import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SidebarDock } from "@/components/layout/SidebarDock";
import { MobileDock } from "@/components/layout/MobileDock";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { LayoutClient } from "./LayoutClient";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { WorkspacePermissionsProvider } from "@/contexts/WorkspacePermissionsContext";
import { PresenceProvider } from "@/contexts/PresenceProvider";
import { UniqAIIslandProvider } from "@/components/uniq-ai/island-context";
import { UniqAIIsland } from "@/components/uniq-ai/dynamic-island";
import { AmbientAIPanel } from "@/components/uniq-ai/ambient-panel";
import { CursorReactiveBackground } from "@/components/layout/CursorReactiveBackground";

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
          <CursorReactiveBackground />
          <UniqAIIslandProvider>
            <div className="flex h-screen overflow-hidden">
              <SidebarDock />
              <LayoutClient>{children}</LayoutClient>
            </div>
            {/* UniqAIIsland (FAB flutuante) só aparece em md+. No mobile,
                a entrada Uniq AI vive no centro do MobileDock. */}
            <div className="hidden md:contents">
              <UniqAIIsland />
            </div>
            <AmbientAIPanel />
            <MobileDock />
            <CommandPalette />
          </UniqAIIslandProvider>
        </PresenceProvider>
      </WorkspacePermissionsProvider>
    </WorkspaceProvider>
  );
}
