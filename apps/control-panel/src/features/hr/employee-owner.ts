import "server-only";
import { cookies } from "next/headers";
import { currentOperatorAccess } from "../../server/current-operator-access";
import { OPERATOR_COOKIE } from "../../server/operator-passkey-bff";
import { isolatedPublicDshOrigin } from "../stores/public-store-query";

export async function employeeOwner() {
  const access = await currentOperatorAccess();
  const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!access?.grants.includes("hr") || !bearer || !/^[A-Za-z0-9_-]{43}$/.test(bearer)) {
    return { status: "denied" } as const;
  }
  const origin = isolatedPublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN);
  if (!origin) return { status: "unavailable" } as const;
  return { status: "available", origin, bearer, actorId: access.actorId } as const;
}
