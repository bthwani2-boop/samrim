package postgres

import (
	"errors"
	"testing"

	"github.com/lib/pq"
)

func TestLegacyCODRecoveryUniquenessConflictsAreDomainErrors(t *testing.T) {
	cases := []struct {
		name       string
		constraint string
		want       error
	}{
		{"submission key", "captain_cod_legacy_recovery_reviews_submitted_idempotency_key_key", ErrIdempotencyConflict},
		{"approval key", "captain_cod_legacy_recovery_reviews_approval_idempotency_key_key", ErrIdempotencyConflict},
		{"truncated submitted key", "captain_cod_legacy_recovery_revie_submitted_idempotency_key_key", ErrIdempotencyConflict},
		{"truncated approval key", "captain_cod_legacy_recovery_revie_approval_idempotency_key_key", ErrIdempotencyConflict},
		{"duplicate document", "captain_cod_legacy_recovery_reviews_evidence_document_id_key", ErrLegacyCODRecoveryEvidence},
		{"duplicate payment", "captain_cod_legacy_recovery_reviews_payment_intent_id_key", ErrLegacyCODRecoveryState},
		{"duplicate order", "captain_cod_legacy_recovery_reviews_order_id_key", ErrLegacyCODRecoveryState},
		{"duplicate reservation", "captain_cod_legacy_recovery_reviews_reservation_id_key", ErrLegacyCODRecoveryState},
		{"active order hold", "captain_cod_reservations_active_order_uq", ErrLegacyCODRecoveryState},
		{"active payment hold", "captain_cod_reservations_active_payment_intent_uq", ErrLegacyCODRecoveryState},
		{"reservation event reused approval key", "captain_cod_reservation_events_idempotency_key_key", ErrIdempotencyConflict},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			actual := mapLegacyCODRecoveryConstraintError(&pq.Error{Code: "23505", Constraint: tc.constraint})
			if !errors.Is(actual, tc.want) {
				t.Fatalf("constraint %s: got %v, want %v", tc.constraint, actual, tc.want)
			}
		})
	}
	unrelated := &pq.Error{Code: "23505", Constraint: "unrecognized_constraint"}
	if got := mapLegacyCODRecoveryConstraintError(unrelated); got != unrelated {
		t.Fatalf("unknown uniqueness violation was masked: %v", got)
	}
	other := &pq.Error{Code: "23503", Constraint: "captain_cod_legacy_recovery_reviews_payment_intent_id_fkey"}
	if got := mapLegacyCODRecoveryConstraintError(other); got != other {
		t.Fatalf("foreign-key violation was masked: %v", got)
	}
}
