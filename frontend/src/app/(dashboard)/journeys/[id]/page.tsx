import { redirect } from "next/navigation";

export default async function JourneyEditRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/agents/builder/${id}`);
}
