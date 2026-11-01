import type { CaptainAssignmentResponse, CaptainCompletionRequest } from "@bthwani/dsh";

type CaptainCompletionAttempt = Readonly<{
  actorID: string;
  assignmentID: string;
  expectedVersion: number;
  request: Pick<CaptainCompletionRequest, "result">;
}>;

// Verify the DSH-owned terminal readback before discarding a recoverable mutation attempt.
export function isConfirmedCaptainCompletion(
  response: CaptainAssignmentResponse | null | undefined,
  attempt: CaptainCompletionAttempt,
): boolean {
  const assignment = response?.assignment;
  return Boolean(assignment &&
    assignment.id === attempt.assignmentID &&
    assignment.captainActorId === attempt.actorID &&
    assignment.state === attempt.request.result &&
    assignment.terminalResult === attempt.request.result &&
    Number.isSafeInteger(assignment.version) &&
    assignment.version > attempt.expectedVersion &&
    typeof assignment.terminalAt === "string" &&
    assignment.terminalAt.length > 0);
}
