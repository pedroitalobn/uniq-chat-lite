import { redirect } from "next/navigation";

// Backward-compat: a tela de personalidade virou a página principal de
// /agents quando o módulo Agentes deixou de ser hub e passou a ser o
// builder de personalidade (Apr/26). Redirect cobre links e bookmarks.
export default function LegacyPersonalityRedirect() {
  redirect("/agents");
}
