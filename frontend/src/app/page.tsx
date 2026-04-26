import { redirect } from "next/navigation";
import { auth } from "@/auth";

// Rota raiz: usuário logado cai direto no Uniq AI (chat estilo Claude que
// interage com todos os módulos via linguagem natural). Antes redirecionava
// pra /instances — UX trocada em Apr/26.
export default async function Home() {
  const session = await auth();
  if (session) redirect("/uniq-ai");
  redirect("/login");
}
