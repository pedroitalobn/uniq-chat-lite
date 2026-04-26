import { redirect } from "next/navigation";

// Backward-compat: o builder de jornadas passou a viver em /journeys/[id]
// quando o módulo Jornadas saiu de dentro de /agents (Apr/26). Mantemos esse
// redirect por algumas semanas pra não quebrar bookmarks e tabs abertas.
export default async function LegacyBuilderRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/journeys/${id}`);
}
