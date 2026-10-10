import { useLocalSearchParams } from "expo-router";
import { FieldNewCase } from "../../src/features/field-operations/field-new-case";
import { FieldAdmissionGate } from "../../src/shell/field-admission-gate";
import { FieldScrollScreen } from "../../src/shell/field-shell";

export default function FieldNewCaseRoute() {
  const { caseId: rawCaseId } = useLocalSearchParams<{ caseId?: string | string[] }>();
  const caseId = Array.isArray(rawCaseId) ? rawCaseId[0] ?? "" : rawCaseId ?? "";
  // A new joining-case identity must never inherit a different case's local draft or pending write.
  return <FieldScrollScreen><FieldAdmissionGate><FieldNewCase key={`field-case:${caseId}`} /></FieldAdmissionGate></FieldScrollScreen>;
}
