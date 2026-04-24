import { redirect } from "next/navigation";

// Deep-link compatibility: a URL antiga /inbox/:id redireciona para o novo
// split view /inbox?c=:id. Mantém links antigos (notificações, bookmarks,
// webhooks que apontavam pra rota anterior) funcionando sem o usuário
// precisar reagir.
export default async function LegacyDetailRedirect({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  redirect(`/inbox?c=${conversationId}`);
}
