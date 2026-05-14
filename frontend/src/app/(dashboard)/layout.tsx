import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SidebarDock } from "@/components/layout/SidebarDock";
import { MobileDock } from "@/components/layout/MobileDock";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { LayoutClient } from "./LayoutClient";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { WorkspacePermissionsProvider } from "@/contexts/WorkspacePermissionsContext";
import { PresenceProvider } from "@/contexts/PresenceProvider";
import { QChatAIIslandProvider } from "@/components/uniq-ai/island-context";
import { QChatAIIsland } from "@/components/uniq-ai/dynamic-island";
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
          <QChatAIIslandProvider>
            <div className="flex h-screen overflow-hidden">
              <SidebarDock />
              <LayoutClient>{children}</LayoutClient>
            </div>
            {/* QChatAIIsland (FAB flutuante) só aparece em md+. No mobile,
                a entrada QChat AI vive no centro do MobileDock. */}
            <div className="hidden md:contents">
              <QChatAIIsland />
            </div>
            <AmbientAIPanel />
            <MobileDock />
            <CommandPalette />
          </QChatAIIslandProvider>
        </PresenceProvider>
      </WorkspacePermissionsProvider>
    </WorkspaceProvider>
  );
}
