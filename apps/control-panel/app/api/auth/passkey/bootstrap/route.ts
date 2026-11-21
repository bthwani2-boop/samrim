import { identityOperations } from "@bthwani/identity";
import { NextResponse } from "next/server";
import {
  boundedRequestBody, boundedResponseJSON, isTrustedOperatorRequest,
  operatorIdentityRequest, resolveInitialOperatorBootstrapConfig, validInitialOperatorPayload,
} from "../../../../../src/server/operator-passkey-bff";
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
  const config=resolveInitialOperatorBootstrapConfig(process.env);
  if (!config) return unavailableSessionResponse();
  if (!isTrustedOperatorRequest(request,config) ||
      request.headers.get("content-type")?.toLowerCase() !== "application/json") {
    return NextResponse.json({code:"INVALID_REQUEST"},{status:400,headers:privateHeaders});
  }
  const raw=await boundedRequestBody(request);
  if (raw===null) return NextResponse.json({code:"INVALID_REQUEST"},{status:400,headers:privateHeaders});
  let body:unknown;
  try {body=JSON.parse(raw)} catch {
    return NextResponse.json({code:"INVALID_REQUEST"},{status:400,headers:privateHeaders});
  }
  if (!validInitialOperatorPayload(body,true)) {
    return NextResponse.json({code:"INVALID_REQUEST"},{status:400,headers:privateHeaders});
  }
  try {
    const reply=await operatorIdentityRequest(config,identityOperations.finishInitialOperatorPasskeyRegistration,
      {headers:{"Content-Type":"application/json"},body:raw});
    if(reply.status===401) return NextResponse.json({code:"UNAUTHORIZED"},{status:401,headers:privateHeaders});
    if(reply.status!==201) return NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
    const result=await boundedResponseJSON(reply);
    if (!result || typeof result !== "object" || Array.isArray(result) ||
        Object.keys(result).length!==1 || (result as { registered?:unknown }).registered!==true) {
      return NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
    }
    // Enrollment is not login. No cookie is set and no Operator session is issued.
    return NextResponse.json({registered:true},{status:201,headers:privateHeaders});
  } catch {
    return NextResponse.json({code:"OWNER_UNAVAILABLE"},{status:503,headers:privateHeaders});
  }
}
