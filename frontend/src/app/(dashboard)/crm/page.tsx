import { redirect } from "next/navigation";

// /crm sempre cai em Deals (pipeline) por padrão. Quem precisa de
// Contatos/Empresas tem o submenu CRMTabs no topo de cada subpágina.
export default function CRMRootRedirect() {
  redirect("/crm/deals");
}
