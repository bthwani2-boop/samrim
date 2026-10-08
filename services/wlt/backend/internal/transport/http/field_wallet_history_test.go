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

func TestReadFieldWalletHistoryRequiresServiceAuthorization(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/wlt/v1/fields/field-1/wallet-history", nil)
	request.SetPathValue("fieldActorId", "field-1")
	response := httptest.NewRecorder()
	(&Server{serviceToken: "service-token"}).readFieldWalletHistory(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized wallet history response = %d %s, want 401", response.Code, response.Body.String())
	}
}

func TestReadFieldWalletHistoryUsesLedgerAndReturnsReducedPagedEntries(t *testing.T) {
	createdAt := time.Date(2026, time.October, 8, 9, 30, 0, 0, time.UTC)
	db := sql.OpenDB(fieldWalletHistoryConnector{createdAt: createdAt})
	defer db.Close()
	db.SetMaxOpenConns(1)
	server := &Server{db: db, serviceToken: "service-token"}
	request := httptest.NewRequest(http.MethodGet, "/wlt/v1/fields/field-1/wallet-history?limit=1", nil)
	request.SetPathValue("fieldActorId", "field-1")
	request.Header.Set("Authorization", "Bearer service-token")
	response := httptest.NewRecorder()
	server.readFieldWalletHistory(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("wallet history response = %d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	var entries []map[string]json.RawMessage
	if err := json.Unmarshal(body["entries"], &entries); err != nil {
		t.Fatal(err)
	}
	var cursor string
	if err := json.Unmarshal(body["nextCursor"], &cursor); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || cursor == "" || entries[0]["type"] == nil || entries[0]["direction"] == nil || entries[0]["balanceAfterMinor"] == nil {
		t.Fatalf("reduced wallet history page = %s", response.Body.String())
	}
	for _, forbidden := range []string{"transactionId", "sourceId", "actorId", "sourceType"} {
		if strings.Contains(response.Body.String(), forbidden) {
			t.Fatalf("wallet history leaked %q: %s", forbidden, response.Body.String())
		}
	}
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil || !strings.Contains(string(decoded), "|ledger-") {
		t.Fatalf("next cursor = %q, decoded=%q err=%v", cursor, decoded, err)
	}
}

func TestReadFieldWalletHistoryRejectsInvalidPagination(t *testing.T) {
	for _, query := range []string{"?limit=0", "?limit=101", "?limit=abc", "?cursor=%%%"} {
		t.Run(query, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/wlt/v1/fields/field-1/wallet-history"+query, nil)
			request.SetPathValue("fieldActorId", "field-1")
			request.Header.Set("Authorization", "Bearer service-token")
			response := httptest.NewRecorder()
			(&Server{serviceToken: "service-token"}).readFieldWalletHistory(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("invalid pagination response = %d %s, want 400", response.Code, response.Body.String())
			}
		})
	}
}

type fieldWalletHistoryConnector struct{ createdAt time.Time }

func (c fieldWalletHistoryConnector) Connect(context.Context) (driver.Conn, error) {
	return &fieldWalletHistoryConnection{createdAt: c.createdAt}, nil
}

func (fieldWalletHistoryConnector) Driver() driver.Driver { return fieldWalletHistoryDriver{} }

type fieldWalletHistoryDriver struct{}

func (fieldWalletHistoryDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("field wallet history driver requires connector")
}

type fieldWalletHistoryConnection struct {
	createdAt time.Time
	queries   int
}

func (*fieldWalletHistoryConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unsupported")
}
func (*fieldWalletHistoryConnection) Close() error { return nil }
func (*fieldWalletHistoryConnection) Begin() (driver.Tx, error) {
	return nil, errors.New("unsupported")
}

func (c *fieldWalletHistoryConnection) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.queries++
	if c.queries == 1 {
		if len(args) != 5 || args[0].Value != "FIELD_WALLET" || args[1].Value != "field" || args[2].Value != "field-1" {
			return nil, errors.New("wallet history query did not constrain the Field wallet actor")
		}
		return &fieldWalletHistoryRows{columns: []string{"opening", "credits", "debits", "closing", "current"}, values: [][]driver.Value{{int64(0), int64(75), int64(0), int64(75), int64(75)}}}, nil
	}
	if !strings.Contains(query, "WHERE e.account_code=$1 AND e.actor_type=$2 AND e.actor_id=$3") {
		return nil, errors.New("wallet history entries query is not actor-scoped")
	}
	return &fieldWalletHistoryRows{columns: []string{"transaction_id", "transaction_type", "source_type", "source_id", "direction", "amount_minor", "currency", "created_at", "balance_after"}, values: [][]driver.Value{
		{"ledger-1", "FIELD_ACQUISITION_ENTITLEMENT_POSTED", "PARTNER_STORE_CLIENT_VISIBLE", "joining-1", "CREDIT", int64(75), "YER", c.createdAt, int64(75)},
		{"ledger-2", "FIELD_ACQUISITION_ENTITLEMENT_POSTED", "PARTNER_STORE_CLIENT_VISIBLE", "joining-2", "CREDIT", int64(25), "YER", c.createdAt.Add(-time.Minute), int64(25)},
	}}, nil
}

type fieldWalletHistoryRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *fieldWalletHistoryRows) Columns() []string { return r.columns }
func (*fieldWalletHistoryRows) Close() error        { return nil }
func (r *fieldWalletHistoryRows) Next(destination []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(destination, r.values[r.index])
	r.index++
	return nil
}
