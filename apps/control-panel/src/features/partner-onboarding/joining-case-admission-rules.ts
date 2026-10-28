import type { JoiningCaseOrigin, JoiningCaseState } from "@bthwani/dsh";

export function canOperatorAdmitJoiningCase(origin: JoiningCaseOrigin, state: JoiningCaseState): boolean {
  return ((origin === "control_panel" || origin === "self_service") && state === "draft") ||
    (origin === "field" && state === "admission_requested");
}
