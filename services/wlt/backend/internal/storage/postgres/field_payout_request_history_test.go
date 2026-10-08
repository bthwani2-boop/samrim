package postgres_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func TestListFieldPayoutRequestHistoryIsActorScopedAndCursorPaged(t *testing.T) {
	createdAt := time.Date(2026, time.October, 8, 9, 30, 0, 0, time.UTC)
	db := sql.OpenDB(fieldPayoutHistoryConnector{createdAt: createdAt})
	defer db.Close()
	page, err := postgres.ListFieldPayoutRequestHistory(context.Background(), db, " field-1 ", nil, "", 1)
	if err != nil {
		t.Fatalf("list payout requests: %v", err)
	}
	if len(page.Requests) != 1 || page.Requests[0].Status != "HELD" || page.Requests[0].AmountMinor != 250 || page.Requests[0].Currency != "YER" || page.NextCursor != createdAt.Format(time.RFC3339Nano)+"|payout-1" {
		t.Fatalf("payout request page = %#v", page)
	}
}

func TestListFieldPayoutRequestHistoryRejectsInvalidCursor(t *testing.T) {
	if _, err := postgres.ListFieldPayoutRequestHistory(context.Background(), nil, "field-1", nil, "payout-1", 1); !errors.Is(err, postgres.ErrPayoutInvalidInput) {
		t.Fatalf("invalid cursor error = %v", err)
	}
}

type fieldPayoutHistoryConnector struct{ createdAt time.Time }

func (c fieldPayoutHistoryConnector) Connect(context.Context) (driver.Conn, error) {
	return fieldPayoutHistoryConnection{createdAt: c.createdAt}, nil
}

func (fieldPayoutHistoryConnector) Driver() driver.Driver { return fieldPayoutHistoryDriver{} }

type fieldPayoutHistoryDriver struct{}

func (fieldPayoutHistoryDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("payout history test driver requires connector")
}

type fieldPayoutHistoryConnection struct{ createdAt time.Time }

func (fieldPayoutHistoryConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unsupported")
}
func (fieldPayoutHistoryConnection) Close() error              { return nil }
func (fieldPayoutHistoryConnection) Begin() (driver.Tx, error) { return nil, errors.New("unsupported") }

func (c fieldPayoutHistoryConnection) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if !strings.Contains(query, "actor_type='field' AND actor_id=$1") || len(args) != 4 || args[0].Value != "field-1" || args[3].Value != int64(2) {
		return nil, errors.New("payout history query is not field actor-scoped and bounded")
	}
	return &fieldPayoutHistoryRows{values: [][]driver.Value{
		{"payout-1", "HELD", int64(250), "YER", c.createdAt},
		{"payout-2", "CANCELLED", int64(100), "YER", c.createdAt.Add(-time.Minute)},
	}}, nil
}

type fieldPayoutHistoryRows struct {
	values [][]driver.Value
	index  int
}

func (*fieldPayoutHistoryRows) Columns() []string {
	return []string{"id", "status", "resolved_amount_minor", "currency", "created_at"}
}
func (*fieldPayoutHistoryRows) Close() error { return nil }
func (r *fieldPayoutHistoryRows) Next(destination []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(destination, r.values[r.index])
	r.index++
	return nil
}
