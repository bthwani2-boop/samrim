import { readCaptainReview } from "../../../../../src/features/captains/captains-read-bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Readonly<{ params: Promise<{ actorId: string }> }>) {
  const { actorId } = await context.params;
  return readCaptainReview(request, actorId);
}
