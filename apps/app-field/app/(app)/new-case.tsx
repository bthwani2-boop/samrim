import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { FieldNewCase } from "../../src/features/field-operations/field-new-case";
import { FieldAdmissionGate } from "../../src/shell/field-admission-gate";
import { FieldScrollScreen } from "../../src/shell/field-shell";

export default function FieldNewCaseRoute() {
  const { caseId: rawCaseId } = useLocalSearchParams<{ caseId?: string | string[] }>();
  const caseId = Array.isArray(rawCaseId) ? rawCaseId[0] ?? "" : rawCaseId ?? "";
  const [stepScrollKey, setStepScrollKey] = useState(0);
  // A new joining-case identity must never inherit a different case's local draft or pending write.
  return <FieldScrollScreen scrollToTopKey={`${caseId}:${stepScrollKey}`}><FieldAdmissionGate><FieldNewCase key={`field-case:${caseId}`} onStepNavigate={() => setStepScrollKey((current) => current + 1)} /></FieldAdmissionGate></FieldScrollScreen>;
}
