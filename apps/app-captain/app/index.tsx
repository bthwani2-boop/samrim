import { ManagedIdentityGate } from "@bthwani/design-system/native";
import { activateManagedIdentity, currentIdentityState, loginManagedIdentity, logoutIdentity, readManagedAuthState, recoverManagedIdentity, requestManagedActivation, requestManagedRecovery, restoreIdentitySession } from "../src/identity";

export default function IdentityGate() {
  return <ManagedIdentityGate roleLabel="الكابتن" readState={readManagedAuthState} requestCode={requestManagedActivation} requestRecovery={requestManagedRecovery} recover={recoverManagedIdentity} login={loginManagedIdentity} activate={activateManagedIdentity} restore={restoreIdentitySession} currentState={currentIdentityState} logout={logoutIdentity} />;
}
