import { ManagedIdentityFlow } from "@bthwani/identity/presentation";
import {
  activateManagedIdentity,
  currentIdentityState,
  loginManagedIdentity,
  logoutIdentity,
  requestManagedActivation,
  restoreIdentitySession,
  role,
  surface,
} from "../../bootstrap/identity";
import { StoreReadback } from "../partner-onboarding/store-readback";

const identity = { role, surface, restoreIdentitySession, currentIdentityState, logoutIdentity, requestManagedActivation, activateManagedIdentity, loginManagedIdentity };

export default function IdentityGate() {
  return (
    <ManagedIdentityFlow
      managedRole={role}
      surface={surface}
      roleLabel="الشريك"
      binding={identity}
      authenticatedContent={<StoreReadback />}
    />
  );
}
