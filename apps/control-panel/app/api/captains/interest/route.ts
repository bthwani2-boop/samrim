import { readCaptainInterestForOperator } from "../../../../src/features/captains/captain-interest-bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return readCaptainInterestForOperator(request);
}
