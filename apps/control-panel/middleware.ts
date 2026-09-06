import { NextResponse, type NextRequest } from "next/server";
import { verifySameOrigin } from "./lib/csrf";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function middleware(request: NextRequest) {
  if (UNSAFE_METHODS.has(request.method.toUpperCase())) {
    if (!verifySameOrigin(request)) {
      return NextResponse.json(
        { error: "FORBIDDEN_CROSS_ORIGIN", message: "Cross-origin requests are forbidden for control-panel mutations" },
        { status: 403 }
      );
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
