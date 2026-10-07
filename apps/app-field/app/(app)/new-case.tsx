import { FieldNewCase } from "../../src/features/field-operations/field-new-case";
import { FieldAdmissionGate } from "../../src/shell/field-admission-gate";
import { FieldScrollScreen } from "../../src/shell/field-shell";

export default function FieldNewCaseRoute() {
  return <FieldScrollScreen><FieldAdmissionGate><FieldNewCase /></FieldAdmissionGate></FieldScrollScreen>;
}
