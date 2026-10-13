package captain

import (
	"errors"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestCaptainOfferAcceptancePreflightProtectsCODReservation(t *testing.T) {
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	active := postgres.CaptainOffer{
		ID: "offer-1", CaptainActorID: "captain-1",
		State: "offered", Version: 2, ExpiresAt: now.Add(time.Minute),
	}
	tests := []struct {
		name        string
		offer       postgres.CaptainOffer
		actorID     string
		version     int
		wantReserve bool
		wantErr     error
	}{
		{name: "valid owner and current version", offer: active, actorID: "captain-1", version: 2, wantReserve: true},
		{name: "different captain cannot trigger COD", offer: active, actorID: "captain-2", version: 2, wantErr: postgres.ErrCaptainOfferForbidden},
		{name: "stale version cannot trigger COD", offer: active, actorID: "captain-1", version: 1, wantErr: postgres.ErrCaptainVersionConflict},
		{name: "already accepted delegates to replay without reservation", offer: func() postgres.CaptainOffer { v := active; v.State = "accepted"; v.Version = 3; return v }(), actorID: "captain-1", version: 2},
		{name: "foreign replay cannot return assignment", offer: func() postgres.CaptainOffer { v := active; v.State = "accepted"; v.Version = 3; return v }(), actorID: "captain-2", version: 2, wantErr: postgres.ErrCaptainOfferForbidden},
		{name: "expired state must not reserve", offer: func() postgres.CaptainOffer { v := active; v.State = "expired"; return v }(), actorID: "captain-1", version: 2},
		{name: "elapsed expiry must not reserve", offer: func() postgres.CaptainOffer { v := active; v.ExpiresAt = now; return v }(), actorID: "captain-1", version: 2},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			reserve, err := captainOfferAcceptancePreflight(tc.offer, tc.actorID, tc.version, now)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if reserve != tc.wantReserve {
				t.Fatalf("reserve = %v, want %v", reserve, tc.wantReserve)
			}
		})
	}
}
