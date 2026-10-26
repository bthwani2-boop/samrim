import { ManagedIdentityFlow, resolveInternalReturnPath } from "@bthwani/identity/presentation";
import { type Href, Redirect, useLocalSearchParams } from "expo-router";
import {
  activateManagedIdentity,
  currentIdentityState,
  loginManagedIdentity,
  recoverManagedIdentity,
  requestManagedActivation,
  requestManagedRecovery,
  restoreIdentitySession,
  role,
  subscribeIdentitySession,
  surface,
} from "../../bootstrap/identity";
import { captainReturnPathPattern } from "./captain-route";

const identity = { role, surface, restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession, requestManagedActivation, activateManagedIdentity, loginManagedIdentity, requestManagedRecovery, recoverManagedIdentity };

export default function IdentityGate() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const safeReturnTo = resolveInternalReturnPath(returnTo, "/home", captainReturnPathPattern) as Href;

  return (
    <ManagedIdentityFlow
      managedRole={role}
      surface={surface}
      binding={identity}
      authenticatedContent={<Redirect href={safeReturnTo} />}
    />
  );
}
