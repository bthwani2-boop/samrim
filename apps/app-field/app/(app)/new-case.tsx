import { FieldOperations } from "../../src/features/field-operations/field-operations";
import { FieldScrollScreen } from "../../src/shell/field-shell";

export default function FieldNewCaseRoute() {
  return <FieldScrollScreen><FieldOperations surface="new-case" /></FieldScrollScreen>;
}
