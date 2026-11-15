package storeavailability

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeIdentity struct {
	actor            VerifiedActor
	denied           bool
	permissionDenied bool
}

func (x fakeIdentity) ResolveCurrentSession(_ context.Context, _ string) (VerifiedActor, error) {
	if x.denied {
		return VerifiedActor{}, errors.New("revoked")
	}
	return x.actor, nil
}
func (x fakeIdentity) RequireOperatorPermission(context.Context, string, string, string) error {
	if x.permissionDenied {
		return errors.New("denied")
	}
	return nil
}

type fakeGrant struct {
	denied              bool
	unavailable         bool
	timezone            string
	timezoneUnavailable bool
}

func (x fakeGrant) StoreTimezone(context.Context, string) (string, error) {
	if x.timezoneUnavailable {
		return "", errors.New("DSH city unavailable")
	}
	if x.timezone != "" {
		return x.timezone, nil
	}
	return "Asia/Aden", nil
}
func (x fakeGrant) RequireStoreAction(context.Context, string, string, string) error {
	if x.unavailable {
		return errors.New("Store owner database unavailable")
	}
	if x.denied {
		return ErrForbidden
	}
	return nil
}

type fakePolicy struct {
	unavailable bool
	versionZero bool
}

func (x fakePolicy) CurrentLimits(context.Context, string) (Limits, error) {
	if x.unavailable {
		return Limits{}, errors.New("unavailable")
	}
	if x.versionZero {
		return Limits{MaxPause: time.Hour, MaxPreparationMinutes: 90}, nil
	}
	return Limits{MaxPause: time.Hour, MaxPreparationMinutes: 90, Version: 1}, nil
}

type fakeRepo struct{ applies *int }

func (x fakeRepo) Read(context.Context, string) (Snapshot, error) { return Snapshot{Version: 1}, nil }
func (x fakeRepo) ReadAuthorized(_ context.Context, storeID, actorID, authority string) (Snapshot, error) {
	if storeID == "" || actorID == "" || authority == "" {
		return Snapshot{}, ErrForbidden
	}
	return Snapshot{StoreID: storeID, Version: 1}, nil
}
func (x fakeRepo) Apply(_ context.Context, c AuthorizedChange) (Snapshot, bool, error) {
	*x.applies++
	return Snapshot{StoreID: c.StoreID, Version: c.ExpectedVersion + 1, ActingActorID: c.ActorID}, false, nil
}
func validChange() Change {
	return Change{StoreID: "store-one", OperationID: "merchant-0001", ExpectedVersion: 1,
		Timezone: "Asia/Aden", Weekly: []WeeklyWindow{{Weekday: time.Monday, Opens: 600, Closes: 1200}},
		PreparationMinutes: 25, Reason: "Temporary opening-hours update"}
}
func TestServiceRequiresCurrentIdentityAndStorePermission(t *testing.T) {
	denyCases := []struct {
		name     string
		identity fakeIdentity
		grant    fakeGrant
		want     error
	}{
		{"revoked identity", fakeIdentity{denied: true}, fakeGrant{}, ErrUnauthorized},
		{"other store", fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, fakeGrant{denied: true}, ErrForbidden},
		{"unauthorized customer", fakeIdentity{actor: VerifiedActor{Subject: "customer-a", Role: "CUSTOMER"}}, fakeGrant{}, ErrForbidden},
		{"operator without operations", fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}, permissionDenied: true}, fakeGrant{}, ErrForbidden},
	}
	for _, tc := range denyCases {
		t.Run(tc.name, func(t *testing.T) {
			count := 0
			s, _ := NewService(tc.identity, tc.grant, fakePolicy{}, fakeRepo{&count})
			_, _, err := s.Change(context.Background(), "verified-token", validChange())
			if !errors.Is(err, tc.want) {
				t.Fatalf("expected %v got %v", tc.want, err)
			}
			if count != 0 {
				t.Fatal("unauthorized mutation reached persistence")
			}
		})
	}
}
func TestServiceOnlyForwardsValidPolicyBoundChanges(t *testing.T) {
	count := 0
	s, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, fakeGrant{}, fakePolicy{}, fakeRepo{&count})
	s.now = func() time.Time { return moment(t, "2026-11-16T10:00:00+03:00") }
	change := validChange()
	pause := s.now().Add(30 * time.Minute)
	change.PausedUntil = &pause
	got, replay, err := s.Change(context.Background(), "verified-token", change)
	if err != nil || replay || got.Version != 2 || got.ActingActorID != "merchant-a" || count != 1 {
		t.Fatalf("unexpected %+v replay %v err %v count %d", got, replay, err, count)
	}
	bad := change
	far := s.now().Add(2 * time.Hour)
	bad.PausedUntil = &far
	_, _, err = s.Change(context.Background(), "verified-token", bad)
	if !errors.Is(err, ErrInvalidChange) || count != 1 {
		t.Fatalf("pause beyond DSH limit: %v", err)
	}
	bad = change
	bad.Timezone = "Pacific/Honolulu"
	_, _, err = s.Change(context.Background(), "verified-token", bad)
	if !errors.Is(err, ErrInvalidChange) || count != 1 {
		t.Fatalf("client-chosen Store timezone bypassed DSH: %v", err)
	}
	bad = change
	bad.PreparationMinutes = 100
	_, _, err = s.Change(context.Background(), "verified-token", bad)
	if !errors.Is(err, ErrInvalidChange) || count != 1 {
		t.Fatalf("bad prep: %v", err)
	}
}
func TestHostLocalStoreTimezoneCannotReachPersistence(t *testing.T) {
	count := 0
	s, err := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}},
		fakeGrant{timezone: "Local"}, fakePolicy{}, fakeRepo{&count})
	if err != nil {
		t.Fatal(err)
	}
	change := validChange()
	change.Timezone = "" // Client cannot override the DSH canonical time zone.
	_, _, err = s.Change(context.Background(), "verified-token", change)
	if !errors.Is(err, ErrInvalidTimezone) || count != 0 {
		t.Fatalf("OS-dependent Store timezone caused a mutation: err=%v count=%d", err, count)
	}
}

func TestNewServiceFailsClosedWithoutOwnerAdapters(t *testing.T) {
	if _, err := NewService(nil, fakeGrant{}, fakePolicy{}, fakeRepo{new(int)}); !errors.Is(err, ErrUnauthorized) {
		t.Fatal(err)
	}
}

type readAuthorizationRecorder struct {
	calls     int
	actor     string
	authority string
}

func (r *readAuthorizationRecorder) Read(context.Context, string) (Snapshot, error) {
	panic("unscoped Store availability read reached from authenticated handler")
}
func (r *readAuthorizationRecorder) ReadAuthorized(_ context.Context, storeID, actorID, authority string) (Snapshot, error) {
	r.calls++
	r.actor, r.authority = actorID, authority
	return Snapshot{StoreID: storeID, Version: 1}, nil
}
func (r *readAuthorizationRecorder) Apply(context.Context, AuthorizedChange) (Snapshot, bool, error) {
	panic("read test must not write")
}

func TestReadForActorPassesVerifiedIdentityIntoOwnerLockedRead(t *testing.T) {
	repo := &readAuthorizationRecorder{}
	svc, err := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, fakeGrant{}, fakePolicy{}, repo)
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.ReadForActor(context.Background(), "current-session", "store-one")
	if err != nil || got.StoreID != "store-one" || repo.calls != 1 ||
		repo.actor != "merchant-a" || repo.authority != "MERCHANT_STORE_GRANT" {
		t.Fatalf("read did not use verified actor/Store transaction: %+v err=%v repo=%+v", got, err, repo)
	}
	svc.identity = fakeIdentity{denied: true}
	if _, err := svc.ReadForActor(context.Background(), "revoked-session", "store-one"); !errors.Is(err, ErrUnauthorized) || repo.calls != 1 {
		t.Fatalf("revoked Identity read reached Store database: %v calls=%d", err, repo.calls)
	}
}
