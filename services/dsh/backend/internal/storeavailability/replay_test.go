package storeavailability

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type historicalReplayRepo struct {
	fakeRepo
	found bool
	err   error
	reads int
}

func (r *historicalReplayRepo) ReplayAuthorized(_ context.Context, c AuthorizedChange) (Snapshot, bool, error) {
	r.reads++
	if c.ActorID != "merchant-a" || c.AuthoritySource != "MERCHANT_STORE_GRANT" {
		return Snapshot{}, false, ErrForbidden
	}
	return Snapshot{StoreID: c.StoreID, Version: 2, Timezone: "Asia/Aden"}, r.found, r.err
}

func TestServiceReplaysCommittedOperationBeforeTimeAndPolicyValidation(t *testing.T) {
	for _, name := range []string{"expired pause", "unavailable current policy", "changed timezone"} {
		t.Run(name, func(t *testing.T) {
			writes := 0
			repo := &historicalReplayRepo{fakeRepo: fakeRepo{&writes}, found: true}
			grant, policy := fakeGrant{}, fakePolicy{}
			change := validChange()
			if name == "expired pause" {
				past := time.Now().Add(-time.Hour)
				change.PausedUntil = &past
			}
			if name == "unavailable current policy" {
				policy.unavailable = true
			}
			if name == "changed timezone" {
				grant.timezone = "Europe/London"
			}
			svc, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, grant, policy, repo)
			got, replay, err := svc.Change(context.Background(), "current-token", change)
			if err != nil || !replay || got.Version != 2 || repo.reads != 1 || writes != 0 {
				t.Fatalf("historical result lost: %+v replay=%v error=%v lookup=%d writes=%d", got, replay, err, repo.reads, writes)
			}
		})
	}
}

func TestServiceReplayStillRequiresCurrentAuthorizationAndExactOperation(t *testing.T) {
	writes := 0
	repo := &historicalReplayRepo{fakeRepo: fakeRepo{&writes}, found: true}
	svc, _ := NewService(fakeIdentity{denied: true}, fakeGrant{}, fakePolicy{}, repo)
	if _, _, err := svc.Change(context.Background(), "revoked", validChange()); !errors.Is(err, ErrUnauthorized) || repo.reads != 0 {
		t.Fatalf("revoked Identity reached replay: %v", err)
	}
	svc.identity = fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}
	svc.grants = fakeGrant{denied: true}
	if _, _, err := svc.Change(context.Background(), "current", validChange()); !errors.Is(err, ErrForbidden) || repo.reads != 0 {
		t.Fatalf("revoked Store reached replay: %v", err)
	}
	svc.grants = fakeGrant{}
	repo.err = ErrOperationConflict
	if _, _, err := svc.Change(context.Background(), "current", validChange()); !errors.Is(err, ErrOperationConflict) || writes != 0 {
		t.Fatalf("mismatched operation reached writer: %v", err)
	}
	repo.err, repo.found = nil, false
	past := time.Now().Add(-time.Hour)
	change := validChange()
	change.PausedUntil = &past
	if _, _, err := svc.Change(context.Background(), "current", change); !errors.Is(err, ErrInvalidChange) || writes != 0 {
		t.Fatalf("new expired operation bypassed policy: %v", err)
	}
}

func TestHTTPReplaysExpiredPauseWithoutRepeatingMutation(t *testing.T) {
	writes := 0
	repo := &historicalReplayRepo{fakeRepo: fakeRepo{&writes}, found: true}
	svc, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, fakeGrant{}, fakePolicy{}, repo)
	handler, _ := NewHandler(svc)
	body := `{"operationId":"merchant-0001","expectedVersion":1,"weekly":[],"preparationMinutes":25,"reason":"Previous commit","pausedUntil":"2020-01-01T00:00:00Z"}`
	req := httptest.NewRequest("PATCH", "/v1/stores/store-one/availability", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer current-session")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	var result struct {
		Replay bool `json:"replay"`
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &result) != nil || !result.Replay || writes != 0 {
		t.Fatalf("HTTP replay failed status=%d body=%s writes=%d", w.Code, w.Body.String(), writes)
	}
}
