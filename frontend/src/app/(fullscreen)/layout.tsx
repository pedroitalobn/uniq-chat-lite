import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";

// Layout minimalista para telas que precisam do viewport completo (canvas do
// builder de jornadas, etc). Apenas protege com auth e envolve com o
// WorkspaceContext — sem sidebar, sem topbar compartilhada. Cada página
// fullscreen é responsável pelo próprio chrome.
export default async function FullscreenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <WorkspaceProvider>
      <div className="h-screen w-screen overflow-hidden bg-background">
        {children}
      </div>
    </WorkspaceProvider>
  );
}
