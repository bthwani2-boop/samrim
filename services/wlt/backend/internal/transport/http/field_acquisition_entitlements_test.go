package http

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestListFieldAcquisitionEntitlementsRejectsInvalidInput(t *testing.T) {
	cases := []struct {
		name  string
		query string
	}{
		{name: "non numeric limit", query: "?limit=many"},
		{name: "limit below range", query: "?limit=0"},
		{name: "limit above range", query: "?limit=101"},
		{name: "oversized cursor", query: "?cursor=" + strings.Repeat("c", 513)},
		{name: "invalid base64 cursor", query: "?cursor=%%%"},
		{name: "cursor without separator", query: "?cursor=" + base64.RawURLEncoding.EncodeToString([]byte("invalid"))},
		{name: "cursor without joining case", query: "?cursor=" + base64.RawURLEncoding.EncodeToString([]byte("2026-10-02T00:00:00Z|  "))},
		{name: "invalid cursor timestamp", query: "?cursor=" + base64.RawURLEncoding.EncodeToString([]byte("not-a-date|case-1"))},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/wlt/v1/fields/field-1/acquisition-entitlements"+test.query, nil)
			request.SetPathValue("fieldActorId", "field-1")
			request.Header.Set("Authorization", "Bearer service-token")
			response := httptest.NewRecorder()
			(&Server{serviceToken: "service-token"}).listFieldAcquisitionEntitlements(response, request)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "INVALID_INPUT") {
				t.Fatalf("invalid entitlement query response = %d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestListFieldAcquisitionEntitlementsReadsPageAndBuildsCursor(t *testing.T) {
	createdAt := time.Date(2026, time.October, 2, 0, 0, 0, 0, time.UTC)
	rows := &fieldEntitlementRows{values: [][]driver.Value{
		{"case-1", "store-1", "partner-1", "field-1", "vertical-1", "type-1", "policy-1", int64(2), int64(250), "YER", "ledger-1", createdAt},
		{"case-2", "store-2", "partner-2", "field-1", "vertical-1", "type-1", "policy-1", int64(2), int64(250), "YER", "ledger-2", createdAt.Add(-time.Minute)},
	}}
	db := sql.OpenDB(fieldEntitlementConnector{rows: rows})
	defer db.Close()

	request := httptest.NewRequest(http.MethodGet, "/wlt/v1/fields/field-1/acquisition-entitlements?limit=1", nil)
	request.SetPathValue("fieldActorId", "field-1")
	request.Header.Set("Authorization", "Bearer service-token")
	response := httptest.NewRecorder()
	(&Server{db: db, serviceToken: "service-token"}).listFieldAcquisitionEntitlements(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("entitlement page response = %d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	var body struct {
		Entitlements []fieldAcquisitionEntitlementJSON `json:"entitlements"`
		NextCursor   string                            `json:"nextCursor"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	wantCursor := base64.RawURLEncoding.EncodeToString([]byte(createdAt.Format(time.RFC3339Nano) + "|case-1"))
	if len(body.Entitlements) != 1 || body.Entitlements[0].StoreID != "store-1" || body.Entitlements[0].LedgerTransactionID != "ledger-1" || body.NextCursor != wantCursor {
		t.Fatalf("entitlement page = %+v, want first record and cursor %q", body, wantCursor)
	}
}

func TestReadFieldAcquisitionEntitlementByJoiningCaseIsServiceAuthenticatedAndReturnsCanonicalRecord(t *testing.T) {
	createdAt := time.Date(2026, time.October, 2, 0, 0, 0, 0, time.UTC)
	rows := &fieldEntitlementRows{values: [][]driver.Value{{
		"case-1", "store-1", "partner-1", "field-1", "vertical-1", "type-1", "policy-1", int64(2), int64(250), "YER", "ledger-1", createdAt,
	}}}
	db := sql.OpenDB(fieldEntitlementConnector{rows: rows})
	defer db.Close()
	server := &Server{db: db, serviceToken: "service-token"}

	unauthorized := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/wlt/v1/field-acquisition-entitlements/case-1", nil)
	request.SetPathValue("joiningCaseId", "case-1")
	server.readFieldAcquisitionEntitlementByJoiningCase(unauthorized, request)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized read response = %d %s, want 401", unauthorized.Code, unauthorized.Body.String())
	}

	response := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/wlt/v1/field-acquisition-entitlements/case-1", nil)
	request.SetPathValue("joiningCaseId", "case-1")
	request.Header.Set("Authorization", "Bearer service-token")
	server.readFieldAcquisitionEntitlementByJoiningCase(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("authorized read response = %d headers=%v body=%s, want no-store 200", response.Code, response.Header(), response.Body.String())
	}
	var body struct {
		Entitlement fieldAcquisitionEntitlementJSON `json:"entitlement"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	item := body.Entitlement
	if item.JoiningCaseID != "case-1" || item.StoreID != "store-1" || item.PartnerActorID != "partner-1" || item.FieldActorID != "field-1" ||
		item.VerticalID != "vertical-1" || item.CommercialStoreTypeID != "type-1" || item.PolicyID != "policy-1" || item.PolicyVersion != 2 ||
		item.RewardMinor != 250 || item.Currency != "YER" || item.LedgerTransactionID != "ledger-1" || item.Status != "POSTED" ||
		item.CreatedAt != createdAt.Format(time.RFC3339Nano) || item.EffectiveAt != createdAt.Format(time.RFC3339Nano) {
		t.Fatalf("entitlement readback = %+v, want complete immutable posted record", item)
	}
}

func TestReadFieldAcquisitionEntitlementByJoiningCaseReturnsNotFound(t *testing.T) {
	db := sql.OpenDB(fieldEntitlementConnector{rows: &fieldEntitlementRows{}})
	defer db.Close()
	request := httptest.NewRequest(http.MethodGet, "/wlt/v1/field-acquisition-entitlements/missing-case", nil)
	request.SetPathValue("joiningCaseId", "missing-case")
	request.Header.Set("Authorization", "Bearer service-token")
	response := httptest.NewRecorder()
	(&Server{db: db, serviceToken: "service-token"}).readFieldAcquisitionEntitlementByJoiningCase(response, request)
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "FIELD_ACQUISITION_ENTITLEMENT_NOT_FOUND") {
		t.Fatalf("missing entitlement response = %d %s, want canonical 404", response.Code, response.Body.String())
	}
}

type fieldEntitlementConnector struct {
	rows *fieldEntitlementRows
}

func (c fieldEntitlementConnector) Connect(context.Context) (driver.Conn, error) {
	return fieldEntitlementConnection{rows: c.rows}, nil
}

func (fieldEntitlementConnector) Driver() driver.Driver {
	return fieldEntitlementDriver{}
}

type fieldEntitlementDriver struct{}

func (fieldEntitlementDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("field entitlement driver requires a connector")
}

type fieldEntitlementConnection struct {
	rows *fieldEntitlementRows
}

func (fieldEntitlementConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepared statements are unsupported")
}

func (fieldEntitlementConnection) Close() error { return nil }

func (fieldEntitlementConnection) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions are unsupported")
}

func (c fieldEntitlementConnection) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &fieldEntitlementRows{values: c.rows.values}, nil
}

type fieldEntitlementRows struct {
	values [][]driver.Value
	index  int
}

func (*fieldEntitlementRows) Columns() []string {
	return []string{"joining_case_id", "store_id", "partner_actor_id", "field_actor_id", "vertical_id", "commercial_store_type_id", "policy_id", "policy_version", "reward_minor", "currency", "ledger_transaction_id", "created_at"}
}

func (*fieldEntitlementRows) Close() error { return nil }

func (r *fieldEntitlementRows) Next(destination []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(destination, r.values[r.index])
	r.index++
	return nil
}
