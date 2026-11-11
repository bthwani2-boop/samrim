package transporthttp

import (
	"encoding/json"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
)

func TestOperatorStoreDetailRelationModelMatchesDSHStore(t *testing.T) {
	for _, relation := range []string{"BTHWANI_PARTNER", "INDEPENDENT_STORE"} {
		t.Run(relation, func(t *testing.T) {
			store := postgres.StoreRecord{
				ID: "store-test", PartnerActorID: "partner-test",
				Name: "Test Store", RelationModel: relation,
				PublicationState: "unpublished", Version: 1,
			}
			response := toStoreView(store, storepublication.PublicationReadiness{})
			if response.RelationModel != relation {
				t.Fatalf("operator detail relation = %q; want %q", response.RelationModel, relation)
			}
			raw, err := json.Marshal(response)
			if err != nil {
				t.Fatal(err)
			}
			var rendered map[string]any
			if err := json.Unmarshal(raw, &rendered); err != nil {
				t.Fatal(err)
			}
			if got, ok := rendered["relationModel"]; !ok || got != relation {
				t.Fatalf("operator detail JSON missing canonical relation model: %s", raw)
			}
		})
	}
}
