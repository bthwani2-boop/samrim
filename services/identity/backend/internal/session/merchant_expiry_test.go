package session

import (
	"database/sql"
	"errors"
	"testing"
	"time"
)

func TestVerifiedCustomerSourceUsesDatabaseClockBoundaries(t *testing.T) {
	now := time.Date(2026, time.November, 15, 18, 0, 0, 0, time.UTC)
	past := now.Add(-time.Minute)
	future := now.Add(time.Minute)
	good := sql.NullTime{Time: past, Valid: true}
	tests := []struct {
		name         string
		verification sql.NullTime
		issued       time.Time
		expires      time.Time
		want         error
	}{
		{"valid current verified source", good, past, future, nil},
		{"issued at DB now", good, now, future, nil},
		{"expiry equal to DB now", good, past, now, ErrUnauthorized},
		{"expired while transaction waited", good, past, now.Add(-time.Nanosecond), ErrUnauthorized},
		{"issued in future", good, future, future.Add(time.Minute), ErrUnauthorized},
		{"missing verification", sql.NullTime{}, past, future, ErrVerificationRequired},
		{"future verification proof", sql.NullTime{Time: future, Valid: true}, past, future, ErrVerificationRequired},
		{"verification at DB now", sql.NullTime{Time: now, Valid: true}, past, future, nil},
		{"expired source overrides missing verification", sql.NullTime{}, past, past, ErrUnauthorized},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := validateVerifiedCustomerAt(tc.verification, tc.issued, tc.expires, now)
			if tc.want == nil {
				if got != nil {
					t.Fatalf("expected verified current source, got %v", got)
				}
				return
			}
			if !errors.Is(got, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, got)
			}
		})
	}
}
