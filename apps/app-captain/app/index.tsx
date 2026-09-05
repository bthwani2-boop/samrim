import { ManagedIdentityGate } from "@bthwani/design-system/native";
import { activateManagedIdentity, currentIdentityState, logoutIdentity, requestManagedActivation, restoreIdentitySession } from "../src/identity";

export default function IdentityGate() {
  return <ManagedIdentityGate roleLabel="الكابتن" requestCode={requestManagedActivation} activate={activateManagedIdentity} restore={restoreIdentitySession} currentState={currentIdentityState} logout={logoutIdentity} />;
}
