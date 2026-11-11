import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { clientSessionKey } from "./client-session-scope";

/** Prevent a delayed Identity token from authorizing a different actor's operation. */
export function assertClientActor(expectedActorID: string): void {
  const session = currentIdentityState();
  if (!expectedActorID || session.kind !== "authenticated" || session.identity.subject.trim() !== expectedActorID) {
    throw new Error("CLIENT_STORE_SESSION_CHANGED");
  }
}

export async function tokenForClientActor(expectedActorID: string): Promise<string> {
  const accessToken = await getUsableIdentityAccessToken();
  assertClientActor(expectedActorID);
  return accessToken;
}

/** Fence private operations against both actor switches and same-actor reauthentication. */
export function assertClientSession(sessionKey: string): void {
  if (!sessionKey || clientSessionKey(currentIdentityState()) !== sessionKey) throw new Error("CLIENT_STORE_SESSION_CHANGED");
}

export async function tokenForClientSession(sessionKey: string): Promise<string> {
  assertClientSession(sessionKey);
  const accessToken = await getUsableIdentityAccessToken();
  assertClientSession(sessionKey);
  return accessToken;
}
