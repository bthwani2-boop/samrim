package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestIndependentReviewTransitionsCannotPublishOrBypassSuspension(t *testing.T) {
	for _, tc := range []struct {
		action, current, wantState, wantReview string
		allowed                                bool
	}{
		{"RETURN_FOR_CORRECTION", "NEEDS_REVIEW", "NEEDS_CORRECTION", "REJECTED", true},
		{"REJECT", "NEEDS_REVIEW", "UNPUBLISHED", "REJECTED", true},
		{"REOPEN_SUSPENSION_FOR_CORRECTION", "SUSPENDED", "NEEDS_CORRECTION", "REJECTED", true},
		{"APPROVE", "NEEDS_REVIEW", "", "", false},
		{"PUBLISHED_INDEPENDENT", "NEEDS_REVIEW", "", "", false},
		{"REJECT", "SUSPENDED", "", "", false},
		{"RETURN_FOR_CORRECTION", "PUBLISHED_INDEPENDENT", "", "", false},
		{"REOPEN_SUSPENSION_FOR_CORRECTION", "NEEDS_REVIEW", "", "", false},
	} {
		t.Run(tc.action+"/"+tc.current, func(t *testing.T) {
			state, review, allowed := independentReviewTransition(tc.action, tc.current)
			if state != tc.wantState || review != tc.wantReview || allowed != tc.allowed {
				t.Fatalf("bad review transition %q -> %q/%q allowed=%v", tc.current, state, review, allowed)
			}
		})
	}
}

func TestIndependentReviewRejectsInvalidFactsBeforeDatabase(t *testing.T) {
	for _, tc := range []struct {
		name, action, reason string
		version              int
	}{
		{"publish action", "PUBLISHED_INDEPENDENT", "Reviewing public content", 2},
		{"approve action", "APPROVE", "Reviewing public content", 2},
		{"short reason", "REJECT", "short", 2},
		{"missing version", "REJECT", "Reviewing public content", 0},
		{"control characters", "REJECT", "bad\x00abuse review", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := DecideIndependentPublicationReview(context.Background(), nil,
				"store-a", "operator-a", tc.action, tc.reason, tc.version, strings.Repeat("k", 16), "correlation")
			if !errors.Is(err, ErrIndependentPublicationReviewInvalid) {
				t.Fatalf("rejected review input must fail closed: %v", err)
			}
		})
	}
}
