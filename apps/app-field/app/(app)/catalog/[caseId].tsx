import { useLocalSearchParams } from "expo-router";

import { FieldCatalog } from "../../../src/features/field-operations/field-catalog";

export default function FieldCatalogRoute() {
  const { caseId } = useLocalSearchParams<{ caseId: string | string[] }>();
  const normalized = Array.isArray(caseId) ? caseId[0] ?? "" : caseId ?? "";
  return <FieldCatalog caseId={normalized} />;
}
