import "server-only";
import { NextResponse } from "next/server";

export function unavailableSessionResponse() {
  return NextResponse.json(
    { code: "OPERATOR_SESSION_UNAVAILABLE", message: "جلسة المشغّل غير متاحة للتحقق حاليًا" },
    { status: 503, headers: {
      "Cache-Control": "private, no-store", "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    } },
  );
}
