import { NextResponse } from "next/server";
import type { ActorIdentity, OperatorPermission } from "@bthwani/identity";

import { operatorWorkspacePermissions } from "../../session/operator-permissions";

export function operatorWorkspacePermissionDenied(identity: ActorIdentity, permission: OperatorPermission) {
  if (identity.role === "operator" && identity.permissions?.includes(permission)) return null;
  const label = operatorWorkspacePermissions.find((item) => item.key === permission)?.label ?? "هذه المساحة";
  return NextResponse.json(
    { error: { code: "FORBIDDEN", message: `صلاحية ${label} مطلوبة` } },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
