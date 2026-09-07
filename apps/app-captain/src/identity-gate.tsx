import { ManagedIdentityFlow } from "@bthwani/identity-flow";
import * as identity from "./identity";

export default function IdentityGate() {
  return (
    <ManagedIdentityFlow
      managedRole="captain"
      surface="app-captain"
      roleLabel="الكابتن"
      binding={identity}
    />
  );
}
