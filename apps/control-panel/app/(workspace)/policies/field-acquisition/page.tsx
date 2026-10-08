import { FieldAcquisitionPolicyWorkspace } from "../../../../src/features/finance/field-acquisition-policy-workspace";
import { PoliciesWorkspace } from "../../../../src/features/policies/policies-workspace";

export default function FieldAcquisitionPolicyPage() {
  return <PoliciesWorkspace resource="field-acquisition"><FieldAcquisitionPolicyWorkspace /></PoliciesWorkspace>;
}

export const metadata = { title: "استحقاق ضم الشريك للميداني" };
