import { unavailableSessionResponse } from "../../../../src/server/request-security";
// No accepted Operator browser issuance/exchange exists yet. Never mint sessions from claims.
export async function GET() { return unavailableSessionResponse(); }
export async function POST() { return unavailableSessionResponse(); }
