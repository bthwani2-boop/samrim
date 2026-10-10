import { useLocalSearchParams } from "expo-router";
import { FieldNewCase } from "../../src/features/field-operations/field-new-case";
import { FieldAdmissionGate } from "../../src/shell/field-admission-gate";

export default function FieldNewCaseRoute() {
  const { caseId: rawCaseId, fresh: rawFresh } = useLocalSearchParams<{ caseId?: string | string[]; fresh?: string | string[] }>();
  const fresh = Array.isArray(rawFresh) ? rawFresh[0] ?? "" : rawFresh ?? "";
  const caseId = fresh ? "" : Array.isArray(rawCaseId) ? rawCaseId[0] ?? "" : rawCaseId ?? "";
  // Each explicit Add Partner action mounts a new empty form; editing still uses its saved case ID.
  return <FieldAdmissionGate><FieldNewCase key={caseId ? `field-case:${caseId}` : `field-new:${fresh}`} caseId={caseId} /></FieldAdmissionGate>;
}
