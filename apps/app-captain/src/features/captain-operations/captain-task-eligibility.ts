import type { CaptainAssignment, CaptainDeliveryTask } from "@bthwani/dsh";

// Only a current, owner-backed delivery task can authorize Captain UI actions.
// A missing or stale task must never enable custody or completion controls.
export function canActOnCaptainTask(
  assignment: Pick<CaptainAssignment, "id" | "state" | "handoff">,
  task: Pick<CaptainDeliveryTask, "assignmentId" | "deliveryState" | "handoffState"> | undefined,
): boolean {
  return Boolean(task && task.assignmentId === assignment.id && task.deliveryState === assignment.state && task.handoffState === assignment.handoff.state);
}
