import "server-only";
import { DshPublicError, listOperatorStorePublicationReview } from "@bthwani/dsh";
import { cookies } from "next/headers";
import { isolatedPublicDshOrigin } from "../features/stores/public-store-query";
import { isReviewStoreInScope, parsePublicationReviewScope } from "../features/stores/publication-review-query";
import { currentOperatorAccess } from "./current-operator-access";
import { OPERATOR_COOKIE } from "./operator-passkey-config";

export async function readOperatorPublicationReview(
  input: Record<string, string | string[] | undefined>, storeId?: string,
) {
  const access = await currentOperatorAccess();
  if (!access?.grants.includes("merchant")) return { kind: "denied" } as const;
  const scope = parsePublicationReviewScope(input);
  if (!scope || (storeId !== undefined && !isReviewStoreInScope(storeId, scope))) return { kind: "invalid" } as const;
  if (!scope.city) return { kind: "unselected", scope } as const;
  const origin = isolatedPublicDshOrigin(process.env.OPERATOR_POLICY_DSH_ORIGIN);
  const bearer = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!origin || !bearer) return { kind: "unavailable", scope } as const;
  try {
    const page = await listOperatorStorePublicationReview(origin, scope.city, scope.relation, bearer, scope.after,
      AbortSignal.timeout(5000));
    return { kind: "ready", scope, page } as const;
  } catch (error) {
    if (error instanceof DshPublicError && (error.status === 401 || error.status === 403)) return { kind: "denied" } as const;
    return { kind: "unavailable", scope } as const;
  }
}
