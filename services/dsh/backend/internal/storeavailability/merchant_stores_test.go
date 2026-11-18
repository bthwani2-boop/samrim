package storeavailability

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type merchantStoreListFake struct {
	fakeGrant
	calls int
	owner string
	fail  error
}

func (g *merchantStoreListFake) ListOwnedMerchantStores(_ context.Context, actor string) ([]MerchantStore, error) {
	g.calls++
	g.owner = actor
	if g.fail != nil {
		return nil, g.fail
	}
	return []MerchantStore{{ID: "store-one", Name: "Own Store", Relation: "MARKETPLACE", Published: false}}, nil
}

func TestMerchantStoreStandingFailClosedAndOwnerScoped(t *testing.T) {
	for _, tc := range []struct {
		name   string
		role   ActorRole
		denied bool
		want   error
		calls  int
	}{
		{"verified merchant", MerchantRole, false, nil, 1},
		{"customer cannot query Store ownership", "CUSTOMER", false, ErrForbidden, 0},
		{"captain cannot query Store ownership", "CAPTAIN", false, ErrForbidden, 0},
		{"operator role is not Store owner", OperatorRole, false, ErrForbidden, 0},
		{"revoked merchant", "MERCHANT", true, ErrUnauthorized, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			grant := &merchantStoreListFake{}
			svc, err := NewService(fakeIdentity{actor: VerifiedActor{Subject: "actor-a", Role: tc.role}, denied: tc.denied}, grant, fakePolicy{}, fakeRepo{new(int)})
			if err != nil {
				t.Fatal(err)
			}
			standing, err := svc.ListMerchantStores(context.Background(), "current-opaque-token")
			if !errors.Is(err, tc.want) || grant.calls != tc.calls {
				t.Fatalf("standing=%+v err=%v calls=%d", standing, err, grant.calls)
			}
			if tc.want == nil && (standing.ActorID != "actor-a" || len(standing.Stores) != 1 || standing.Stores[0].ID != "store-one" || grant.owner != "actor-a") {
				t.Fatalf("owner scope lost: %+v owner=%q", standing, grant.owner)
			}
		})
	}
	grant := &merchantStoreListFake{fail: errors.New("database offline")}
	svc, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "actor-a", Role: MerchantRole}}, grant, fakePolicy{}, fakeRepo{new(int)})
	if _, err := svc.ListMerchantStores(context.Background(), "current-opaque-token"); !errors.Is(err, ErrStoreOwnerUnavailable) {
		t.Fatalf("DB outage must fail closed: %v", err)
	}
	svc, _ = NewService(fakeIdentity{actor: VerifiedActor{Subject: "actor-a", Role: MerchantRole}}, fakeGrant{}, fakePolicy{}, fakeRepo{new(int)})
	if _, err := svc.ListMerchantStores(context.Background(), "current-opaque-token"); !errors.Is(err, ErrStoreOwnerUnavailable) {
		t.Fatalf("missing canonical DSH reader must fail closed: %v", err)
	}
}

func TestMerchantStoreStandingHTTP(t *testing.T) {
	grant := &merchantStoreListFake{}
	svc, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "actor-a", Role: MerchantRole}}, grant, fakePolicy{}, fakeRepo{new(int)})
	handler, err := NewHandler(svc)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, authorization string
		status              int
	}{
		{"current merchant", "Bearer opaque-merchant", 200},
		{"missing bearer", "", 401},
		{"duplicate bearer", "Bearer opaque-merchant", 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/stores/mine", nil)
			if tc.authorization != "" {
				req.Header.Add("Authorization", tc.authorization)
			}
			if tc.name == "duplicate bearer" {
				req.Header.Add("Authorization", tc.authorization)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.status || rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status=%d want=%d headers=%v", rec.Code, tc.status, rec.Header())
			}
			if tc.status == 200 {
				var standing MerchantStoreStanding
				if err := json.Unmarshal(rec.Body.Bytes(), &standing); err != nil || standing.ActorID != "actor-a" || len(standing.Stores) != 1 {
					t.Fatalf("invalid owner JSON: %s err=%v", rec.Body.String(), err)
				}
			}
		})
	}
}
