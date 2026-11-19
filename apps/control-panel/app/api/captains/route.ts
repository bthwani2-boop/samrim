import { readCaptainReview } from "../../../src/features/captains/captains-read-bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return readCaptainReview(request);
}
