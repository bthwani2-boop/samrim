package postgres

import "time"

// OperatorStageSLA evaluates only explicitly approved, immutable policies.
// A missing event or policy is unknown, never a fabricated on-time result.
type OperatorStageSLA struct {
	Status         string
	Reason         string
	DeadlineAt     *time.Time
	TargetMinutes  int
	WarningMinutes int
	PolicyVersion  int
}

func EvaluateOperatorStageSLA(now time.Time, state string, stageAt *time.Time, targetMinutes, warningMinutes, version int) OperatorStageSLA {
	switch state {
	case "CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_DISPATCH", "READY_FOR_PICKUP", "CAPTAIN_ASSIGNED", "IN_CUSTODY":
	default:
		return OperatorStageSLA{Status: "NOT_APPLICABLE", Reason: "TERMINAL_OR_UNTRACKED_STAGE"}
	}
	if stageAt == nil || stageAt.After(now.Add(time.Minute)) {
		return OperatorStageSLA{Status: "MISSING_EVENT", Reason: "NO_CANONICAL_STAGE_ENTRY"}
	}
	if targetMinutes < 1 || warningMinutes < 0 || warningMinutes >= targetMinutes || version < 1 {
		return OperatorStageSLA{Status: "UNCONFIGURED", Reason: "NO_APPROVED_STAGE_POLICY"}
	}
	deadline := stageAt.Add(time.Duration(targetMinutes) * time.Minute)
	result := OperatorStageSLA{
		Status: "ON_TRACK", Reason: "APPROVED_POLICY", DeadlineAt: &deadline,
		TargetMinutes: targetMinutes, WarningMinutes: warningMinutes, PolicyVersion: version,
	}
	if !now.Before(deadline) {
		result.Status = "OVERDUE"
		result.Reason = "STAGE_DEADLINE_PASSED"
	} else if !now.Before(deadline.Add(-time.Duration(warningMinutes) * time.Minute)) {
		result.Status = "AT_RISK"
		result.Reason = "STAGE_DEADLINE_APPROACHING"
	}
	return result
}
