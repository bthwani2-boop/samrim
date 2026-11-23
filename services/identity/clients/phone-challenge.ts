import { identityOperations } from "./generated/identity-operations.ts";
import { IdentityClientError, issuedSessionFrom, ownerRequest } from "./transport.ts";
import type { IssuedRoleSession } from "./types.ts";

const phoneTicket = /^[a-f0-9]{48}$/;

/** Accept local or international Yemeni mobile input and return the owner format. */
export function normalizeYemeniMobile(value: string): string | undefined {
  const digits = value.trim().replace(/[٠-٩۰-۹]/g, digit =>
    String(digit.charCodeAt(0) - (digit <= "٩" ? 0x660 : 0x6f0)));
  const canonical = /^7[01237][0-9]{7}$/.test(digits) ? "+967" + digits : digits;
  return /^\+9677[01237][0-9]{7}$/.test(canonical) ? canonical : undefined;
}

export async function issueCustomerPhoneChallenge(
  baseUrl: string, phone: string, signal?: AbortSignal,
): Promise<string> {
  const result = await ownerRequest(baseUrl, identityOperations.issueCustomerPhoneChallenge.path, null,
    "POST", 201, signal, { phone });
  if (!result || typeof result !== "object" || !("ticket" in result) ||
    Object.keys(result).length !== 1 || typeof result.ticket !== "string" || !phoneTicket.test(result.ticket)) {
    throw new IdentityClientError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return result.ticket;
}

export async function verifyCustomerPhoneChallenge(
  baseUrl: string, ticket: string, code: string, signal?: AbortSignal,
): Promise<IssuedRoleSession> {
  return issuedSessionFrom(await ownerRequest(baseUrl, identityOperations.verifyCustomerPhoneChallenge.path, null,
    "POST", 200, signal, { ticket, code }));
}
