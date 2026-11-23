import { readCaptainInterestForOperator } from "../../../../../../src/features/captains/captain-interest-bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return readCaptainInterestForOperator(request, id);
}
