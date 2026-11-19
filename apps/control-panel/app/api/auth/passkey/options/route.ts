import { NextResponse } from "next/server";
import {
  boundedResponseJSON,
  isEmptyRequestBody,
  isTrustedOperatorRequest,
  operatorIdentityRequest,
  parsePasskeyOptions,
  resolveIsolatedOperatorConfig,
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
  const config = resolveIsolatedOperatorConfig(process.env);
  if (!config) return unavailableSessionResponse();
  if (!isTrustedOperatorRequest(request, config) || !(await isEmptyRequestBody(request))) {
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400, headers: privateHeaders });
  }
  try {
    const upstream = await operatorIdentityRequest(
      config,
      "/v1/operators/passkey/authentication/options",
      { method: "POST" },
    );
    if (upstream.status !== 200) {
      return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    }
    const options = parsePasskeyOptions(await boundedResponseJSON(upstream));
    if (!options) {
      return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    }
    return NextResponse.json(options, { status: 200, headers: privateHeaders });
  } catch {
    return NextResponse.json({ code: "OWNER_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
  }
}
