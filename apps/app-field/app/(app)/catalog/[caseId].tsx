import { useLocalSearchParams } from "expo-router";

import { FieldCatalog } from "../../../src/features/field-operations/field-catalog";
import { FieldAdmissionGate } from "../../../src/shell/field-admission-gate";

export default function FieldCatalogRoute() {
  const { caseId } = useLocalSearchParams<{ caseId: string | string[] }>();
  const normalized = Array.isArray(caseId) ? caseId[0] ?? "" : caseId ?? "";
  return <FieldAdmissionGate><FieldCatalog caseId={normalized} /></FieldAdmissionGate>;
}
