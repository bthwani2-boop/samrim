package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeaccess"
)

func TestStoreAccessRevokeRequiresWLTReviewBeforeDSHCommit(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("isolated DSH_DATABASE_URL is required")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, statements []string) {
		if err := postgres.Migrate(ctx, db, records, statements, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const store, owner, staff = "payout-gate-store", "payout-gate-owner", "payout-gate-staff"
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: owner, Name: "Payout gate test"})
		grant, _, err := postgres.CreateStoreAccessInvitation(ctx, db, store, owner, staff, []string{"orders"}, "gate-invite-123456", "gate-invite-correlation")
		if err != nil {
			t.Fatal(err)
		}
		grant, _, err = postgres.DecideStoreAccessInvitation(ctx, db, grant.ID, staff, "accept", "active", grant.Version, "gate-accept-123456", "gate-accept-correlation")
		if err != nil || grant.State != "active" {
			t.Fatalf("grant not active: %+v, err=%v", grant, err)
		}

		idServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/auth/session" {
				http.NotFound(w, r)
				return
			}
			actor := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"subject": actor, "role": "partner", "surface": "app-partner", "expiresAt": time.Now().Add(time.Hour)})
		}))
		defer idServer.Close()
		endpoint, err := identityintegration.ResolveBaseURL(idServer.URL, "test")
		if err != nil {
			t.Fatal(err)
		}
		identity, err := identityintegration.New(endpoint, strings.Repeat("i", 32))
		if err != nil {
			t.Fatal(err)
		}

		unavailable := true
		reads, reviews := 0, 0
		reviewWhileActive := false
		wltServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodGet && r.URL.Path == fmt.Sprintf("/wlt/v1/partners/%s/store-payout-recipients/%s", owner, store):
				reads++
				if unavailable {
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte(`{"error":{"code":"UNAVAILABLE"}}`))
					return
				}
				_, _ = w.Write([]byte(fmt.Sprintf(`{"storeId":%q,"state":"SELECTED_VERIFIED_STAFF","beneficiaryActorId":%q,"version":2}`, store, staff)))
			case r.Method == http.MethodPost && r.URL.Path == "/wlt/v1/store-payout-recipients/"+store+"/review-required":
				reviews++
				current, err := postgres.ReadStoreAccessGrant(ctx, db, grant.ID)
				reviewWhileActive = err == nil && current.State == "active"
				_, _ = w.Write([]byte(`{"state":"RECIPIENT_REVIEW_REQUIRED","applied":true}`))
			default:
				t.Errorf("unexpected WLT call %s %s", r.Method, r.URL.Path)
				http.NotFound(w, r)
			}
		}))
		defer wltServer.Close()
		wlt, err := wltintegration.New(wltServer.URL, "test", "fake-token")
		if err != nil {
			t.Fatal(err)
		}
		svc, err := storeaccess.New(identity, db, wlt)
		if err != nil {
			t.Fatal(err)
		}

		const idem, corr = "gate-revoke-123456", "gate-revoke-correlation"
		if _, _, err := svc.TransitionForOwner(ctx, owner, store, grant.ID, "revoked", grant.Version, idem, corr); err == nil {
			t.Fatal("WLT unavailable must prevent DSH revoke commit")
		}
		got, err := postgres.ReadStoreAccessGrant(ctx, db, grant.ID)
		if err != nil || got.State != "active" || got.Version != grant.Version {
			t.Fatalf("WLT outage mutated DSH grant: got=%+v err=%v", got, err)
		}
		if reviews != 0 || reads != 1 {
			t.Fatalf("unexpected WLT calls during outage reads=%d reviews=%d", reads, reviews)
		}

		unavailable = false
		if _, _, err := svc.TransitionForOwner(ctx, "different-owner", store, grant.ID, "revoked", grant.Version, "gate-foreign-12345", corr); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("foreign owner not rejected: %v", err)
		}
		if reviews != 0 || reads != 1 {
			t.Fatal("foreign owner touched WLT")
		}
		result, replay, err := svc.TransitionForOwner(ctx, owner, store, grant.ID, "revoked", grant.Version, idem, corr)
		if err != nil || replay || result.State != "revoked" || !reviewWhileActive {
			t.Fatalf("WLT review was not acknowledged before DSH commit: %+v replay=%t whileActive=%t err=%v", result, replay, reviewWhileActive, err)
		}
		replayed, replay, err := svc.TransitionForOwner(ctx, owner, store, grant.ID, "revoked", grant.Version, idem, corr)
		if err != nil || !replay || replayed.ID != grant.ID {
			t.Fatalf("repeated operation did not replay safely: %+v replay=%t err=%v", replayed, replay, err)
		}
	})
}
