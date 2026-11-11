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

/** Fence a checkout mutation/read against same-actor reauthentication too. */
export async function tokenForClientSession(sessionKey: string): Promise<string> {
  if (!sessionKey || clientSessionKey(currentIdentityState()) !== sessionKey) throw new Error("CLIENT_STORE_SESSION_CHANGED");
  const accessToken = await getUsableIdentityAccessToken();
  if (clientSessionKey(currentIdentityState()) !== sessionKey) throw new Error("CLIENT_STORE_SESSION_CHANGED");
  return accessToken;
}
