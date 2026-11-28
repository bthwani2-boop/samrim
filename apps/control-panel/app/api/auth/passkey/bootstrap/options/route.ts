import { identityOperations } from "@bthwani/identity";
import { NextResponse } from "next/server";
import { isTrustedOperatorRequest, resolveInitialOperatorBootstrapConfig } from "../../../../../../src/server/operator-passkey-config";
import { boundedRequestBody, boundedResponseJSON, operatorIdentityRequest } from "../../../../../../src/server/operator-passkey-transport";
import { parseInitialOperatorOptions, validInitialOperatorPayload } from "../../../../../../src/server/operator-passkey-validation";
import { unavailableSessionResponse } from "../../../../../../src/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export async function POST(request: Request) {
  const config = resolveInitialOperatorBootstrapConfig(process.env);
  if (!config) return unavailableSessionResponse();
  if (!isTrustedOperatorRequest(request, config) ||
      request.headers.get("content-type")?.toLowerCase() !== "application/json") {
    return NextResponse.json({ code:"INVALID_REQUEST" }, { status:400, headers:privateHeaders });
  }
  const raw = await boundedRequestBody(request);
  if (raw === null) return NextResponse.json({ code:"INVALID_REQUEST" }, { status:400, headers:privateHeaders });
  let body: unknown;
  try { body=JSON.parse(raw); } catch {
    return NextResponse.json({ code:"INVALID_REQUEST" }, { status:400, headers:privateHeaders });
  }
  if (!validInitialOperatorPayload(body, false)) {
    return NextResponse.json({ code:"INVALID_REQUEST" }, { status:400, headers:privateHeaders });
  }
  try {
    const reply=await operatorIdentityRequest(config,identityOperations.beginInitialOperatorPasskeyRegistration,
      { headers:{"Content-Type":"application/json"},body:raw });
    if (reply.status===401) return NextResponse.json({code:"UNAUTHORIZED"},{status:401,headers:privateHeaders});
    if (reply.status!==200) return NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
    const options=parseInitialOperatorOptions(await boundedResponseJSON(reply));
    if (!options) return NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
    return NextResponse.json(options,{status:200,headers:privateHeaders});
  } catch {
    return NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
  }
}
