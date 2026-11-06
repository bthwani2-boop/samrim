package wlt

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFinanceEvidenceDownloadUsesFreshServiceFactsAndRejectsLegacyRead(t *testing.T) {
	const basePath = "/wlt/v1/operator/finance-evidence-documents/document-1"
	var verifiedCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer service-token" || r.Header.Get("X-Acting-Actor-ID") != "finance-operator" {
			t.Errorf("missing trusted operator/service boundary on %s", r.URL.Path)
			w.WriteHeader(http.StatusForbidden)
			return
		}
		switch r.URL.Path {
		case basePath + "/access-context":
			if r.Method != http.MethodGet {
				t.Errorf("metadata read used %s instead of GET", r.Method)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"purpose":"SETTLEMENT_BATCH_EXPORT","batchId":"batch-1","requiresCurrentIdentityFacts":true}`)
		case basePath + "/verified-download":
			verifiedCalls++
			if r.Method != http.MethodPost || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				t.Errorf("verified download used unsafe request method/content type")
			}
			var payload struct {
				Facts []IdentityFacts `json:"identityFactsByBeneficiary"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || len(payload.Facts) != 1 || payload.Facts[0].ActorID != "staff-1" || payload.Facts[0].RoleVersion != 4 {
				t.Errorf("verified download lost canonical identity facts: %+v, %v", payload, err)
			}
			w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
			w.Header().Set("Content-Disposition", `attachment; filename="settlement-batch.xlsx"`)
			_, _ = io.WriteString(w, "mock-workbook")
		case basePath:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_, _ = io.WriteString(w, `{"error":{"code":"REVERIFICATION_REQUIRED","message":"current identity required"}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := New(server.URL, "test", "service-token")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	access, err := client.ReadFinanceEvidenceAccessContext(ctx, "document-1", "finance-operator")
	if err != nil || access.BatchID != "batch-1" || !access.RequiresCurrentIdentityFacts {
		t.Fatalf("unusable settlement export context: %+v, %v", access, err)
	}
	facts := []IdentityFacts{{ActorType: "partner", ActorID: "staff-1", RoleVersion: 4}}
	file, err := client.ReadFinanceEvidenceDocument(ctx, "document-1", "finance-operator", facts)
	if err != nil || file.Filename != "settlement-batch.xlsx" || string(file.Content) != "mock-workbook" || verifiedCalls != 1 {
		t.Fatalf("verified transfer document read failed: %+v, %v, calls=%d", file, err, verifiedCalls)
	}
	if _, err := client.ReadFinanceEvidenceDocument(ctx, "document-1", "finance-operator", nil); err == nil {
		t.Fatal("legacy read unexpectedly bypassed current Identity verification")
	}
}
