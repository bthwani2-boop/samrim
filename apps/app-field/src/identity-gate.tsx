import { ManagedIdentityFlow } from "@bthwani/identity-flow";
import * as identity from "./identity";

export default function IdentityGate() {
  return (
    <ManagedIdentityFlow
      managedRole="field"
      surface="app-field"
      roleLabel="الميدان"
      binding={identity}
    />
  );
}
