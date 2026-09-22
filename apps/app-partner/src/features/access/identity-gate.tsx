import { ManagedIdentityFlow, resolveInternalReturnPath } from "@bthwani/identity/presentation";
import { type Href, Redirect, useLocalSearchParams } from "expo-router";
import {
  activateManagedIdentity,
  currentIdentityState,
  loginManagedIdentity,
  requestManagedActivation,
  restoreIdentitySession,
  role,
  subscribeIdentitySession,
  surface,
} from "../../bootstrap/identity";

const identity = { role, surface, restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession, requestManagedActivation, activateManagedIdentity, loginManagedIdentity };

export default function IdentityGate() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const safeReturnTo = resolveInternalReturnPath(returnTo, "/store", /^(?:\/store|\/orders|\/wallet|\/account|\/onboarding)$/u) as Href;

  return (
    <ManagedIdentityFlow
      managedRole={role}
      surface={surface}
      roleLabel="الشريك"
      binding={identity}
      authenticatedContent={<Redirect href={safeReturnTo} />}
    />
  );
}
