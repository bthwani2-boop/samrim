import { redirect } from "next/navigation";

// Deep links to an individual joining case now open its file inside the one partner workbench.
export default async function LegacyPartnerCasePage({ params }: Readonly<{ params: Promise<{ caseId: string }> }>) {
  const { caseId } = await params;
  if (!caseId || caseId.length > 128) redirect("/partners?view=joining");
  redirect(`/partners?view=joining&case=${encodeURIComponent(caseId)}`);
}
