package catalog

import "testing"

func TestStoreCatalogImportRunIDSeparatesRefreshFromIdempotentReplay(t *testing.T) {
	const (
		storeID = "store_one"
		caseID  = "case_one"
		source  = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	)
	first := storeCatalogImportRunID(storeID, caseID, source, "preview-attempt-one")
	replay := storeCatalogImportRunID(storeID, caseID, source, "preview-attempt-one")
	refreshed := storeCatalogImportRunID(storeID, caseID, source, "preview-attempt-two")
	otherStore := storeCatalogImportRunID("store_two", caseID, source, "preview-attempt-one")
	if first != replay {
		t.Fatalf("an idempotent preview retry changed run ID: %q != %q", first, replay)
	}
	if first == refreshed {
		t.Fatal("a fresh preview after stale-row rejection reused the committed run ID")
	}
	if first == otherStore {
		t.Fatal("store-scoped previews shared a run ID")
	}
}
