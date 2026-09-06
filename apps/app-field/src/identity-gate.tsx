import { ManagedIdentityFlow } from "@bthwani/identity/presentation";
import * as identity from "./identity";

export default function IdentityGate() {
  return (
    <ManagedIdentityFlow
      role="field"
      surface="app-field"
      roleLabel="الميدان"
      binding={identity}
    />
  );
}
