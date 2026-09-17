import { ManagedIdentityFlow } from "@bthwani/identity/presentation";
import { Redirect, type Href } from "expo-router";
import {
  activateManagedIdentity,
  currentIdentityState,
  loginManagedIdentity,
  requestManagedActivation,
  restoreIdentitySession,
  subscribeIdentitySession,
  role,
  surface,
} from "../../bootstrap/identity";

const identity = { role, surface, restoreIdentitySession, currentIdentityState, subscribe: subscribeIdentitySession, requestManagedActivation, activateManagedIdentity, loginManagedIdentity };

export default function IdentityGate() {
  return (
    <ManagedIdentityFlow
      managedRole={role}
      surface={surface}
      roleLabel="الشريك"
      binding={identity}
    authenticatedContent={<Redirect href={"/store" as Href} />}
    />
  );
}
