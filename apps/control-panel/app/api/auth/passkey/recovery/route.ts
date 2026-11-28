import { identityOperations } from "@bthwani/identity";
import { NextResponse } from "next/server";
import { isTrustedOperatorRequest, resolveOperatorRecoveryConfig } from "../../../../../src/server/operator-passkey-config";
import { boundedRequestBody, boundedResponseJSON, operatorIdentityRequest } from "../../../../../src/server/operator-passkey-transport";
import { validInitialOperatorPayload } from "../../../../../src/server/operator-passkey-validation";
import { unavailableSessionResponse } from "../../../../../src/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export async function POST(request: Request) {
  const config=resolveOperatorRecoveryConfig(process.env);
  if(!config) return unavailableSessionResponse();
  if(!isTrustedOperatorRequest(request,config) ||
    request.headers.get("content-type")?.toLowerCase() !== "application/json") {
    return NextResponse.json({code:"INVALID_REQUEST"},{status:400,headers:privateHeaders});
  }
  const raw=await boundedRequestBody(request);
  if(raw===null) return NextResponse.json({code:"INVALID_REQUEST"},{status:400,headers:privateHeaders});
  let body:unknown;
  try {body=JSON.parse(raw)} catch {
    return NextResponse.json({code:"INVALID_REQUEST"},{status:400,headers:privateHeaders});
  }
  if(!validInitialOperatorPayload(body,true)) {
    return NextResponse.json({code:"INVALID_REQUEST"},{status:400,headers:privateHeaders});
  }
  try {
    const reply=await operatorIdentityRequest(config,identityOperations.finishExistingOperatorPasskeyRecovery,
      {headers:{"Content-Type":"application/json"},body:raw});
    if(reply.status===401) return NextResponse.json({code:"UNAUTHORIZED"},{status:401,headers:privateHeaders});
    if(reply.status!==200) return NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
    const result=await boundedResponseJSON(reply);
    if(!result || typeof result!=="object" || Array.isArray(result) ||
      Object.keys(result).length!==1 || (result as {recovered?:unknown}).recovered!==true) {
      return NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
    }
    // The recovery ceremony never issues a session or sets a browser cookie.
    return NextResponse.json({recovered:true},{status:200,headers:privateHeaders});
  } catch {
    return NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
  }
}
