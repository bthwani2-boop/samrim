package storepublication

import (
	"context"
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestStoreRelationBlocksMarketplacePublication(t *testing.T) {
	for _, relation := range []string{postgres.StoreRelationIndependent, "", "UNKNOWN"} {
		t.Run(relation, func(t *testing.T) {
			readinessCalled := false
			ready, err := evaluatePublicationGuard(context.Background(), "published", postgres.StoreRecord{
				RelationModel: relation,
			}, func(context.Context, postgres.StoreRecord) (PublicationReadiness, error) {
				readinessCalled = true
				return PublicationReadiness{Ready: true}, nil
			})
			if !errors.Is(err, ErrPublicationReadinessBlocked) {
				t.Fatalf("non-marketplace relation %q must block publication: %v", relation, err)
			}
			if readinessCalled {
				t.Fatal("must not query marketplace financial/readiness services for independent store")
			}
			if ready.Ready || ready.BlockedReason != StoreNotMarketplaceReason {
				t.Fatalf("invalid marketplace block details: %#v", ready)
			}
		})
	}
}

func TestStoreRelationKeepsMarketplacePublicationAndHiding(t *testing.T) {
	readinessCalled := false
	ready, err := evaluatePublicationGuard(context.Background(), "published", postgres.StoreRecord{
		RelationModel: postgres.StoreRelationBThwaniPartner,
	}, func(context.Context, postgres.StoreRecord) (PublicationReadiness, error) {
		readinessCalled = true
		return PublicationReadiness{Ready: true}, nil
	})
	if err != nil || !ready.Ready || !readinessCalled {
		t.Fatalf("legacy marketplace publication must retain readiness gate: ready=%#v err=%v", ready, err)
	}

	readinessCalled = false
	_, err = evaluatePublicationGuard(context.Background(), "hidden", postgres.StoreRecord{
		RelationModel: postgres.StoreRelationIndependent,
	}, func(context.Context, postgres.StoreRecord) (PublicationReadiness, error) {
		readinessCalled = true
		return PublicationReadiness{}, nil
	})
	if err != nil || readinessCalled {
		t.Fatalf("hiding independent store must remain possible without WLT/Identity: called=%t err=%v", readinessCalled, err)
	}
}
