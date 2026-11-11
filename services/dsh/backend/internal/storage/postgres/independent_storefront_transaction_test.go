package postgres

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
)

// This driver exercises database/sql's actual BeginTx/QueryRow/Rollback
// behavior without reaching a persistent or shared PostgreSQL instance.
// It is intentionally limited to an unpublished Store; full SQL execution
// and authorization against PostgreSQL have separate isolated QA gates.
type independentSnapshotProbe struct {
	begins    int
	queries   int
	commits   int
	rollbacks int
	options   driver.TxOptions
	lastQuery string
}
type independentSnapshotProbeDriver struct{ probe *independentSnapshotProbe }
type independentSnapshotProbeConn struct{ probe *independentSnapshotProbe }
type independentSnapshotProbeTx struct{ probe *independentSnapshotProbe }
type independentSnapshotProbeRows struct{}

var independentSnapshotDriverSequence atomic.Uint64

func (d independentSnapshotProbeDriver) Open(string) (driver.Conn, error) {
	return &independentSnapshotProbeConn{probe: d.probe}, nil
}
func (c *independentSnapshotProbeConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepared statement in snapshot test")
}
func (c *independentSnapshotProbeConn) Close() error { return nil }
func (c *independentSnapshotProbeConn) Begin() (driver.Tx, error) {
	return nil, errors.New("snapshot must use BeginTx with explicit read-only isolation")
}
func (c *independentSnapshotProbeConn) BeginTx(_ context.Context, options driver.TxOptions) (driver.Tx, error) {
	c.probe.begins++
	c.probe.options = options
	return &independentSnapshotProbeTx{probe: c.probe}, nil
}
func (c *independentSnapshotProbeConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.probe.queries++
	c.probe.lastQuery = query
	// An unpublished Store must yield no row. Further Catalog reads are
	// forbidden, so any second query is a test failure.
	if c.probe.queries != 1 {
		return nil, errors.New("catalog queried after unpublished Store gate")
	}
	return independentSnapshotProbeRows{}, nil
}
func (t *independentSnapshotProbeTx) Commit() error            { t.probe.commits++; return nil }
func (t *independentSnapshotProbeTx) Rollback() error          { t.probe.rollbacks++; return nil }
func (independentSnapshotProbeRows) Columns() []string         { return []string{"unpublished"} }
func (independentSnapshotProbeRows) Close() error              { return nil }
func (independentSnapshotProbeRows) Next([]driver.Value) error { return io.EOF }

func newIndependentSnapshotProbeDB(t *testing.T) (*sql.DB, *independentSnapshotProbe) {
	t.Helper()
	probe := &independentSnapshotProbe{}
	name := fmt.Sprintf("bthwani-independent-readonly-snapshot-%d", independentSnapshotDriverSequence.Add(1))
	sql.Register(name, independentSnapshotProbeDriver{probe: probe})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db, probe
}

func TestIndependentPublicCatalogTransactionRejectsDraftBeforeReadingOffers(t *testing.T) {
	db, probe := newIndependentSnapshotProbeDB(t)
	_, err := ListPublishedIndependentOffers(context.Background(), db, "draft-store", "approved-legal-v1", 20, "")
	if !errors.Is(err, ErrIndependentStorefrontNotPublished) {
		t.Fatalf("draft Store must be unavailable, got %v", err)
	}
	if probe.begins != 1 || probe.options.Isolation != driver.IsolationLevel(sql.LevelRepeatableRead) ||
		!probe.options.ReadOnly {
		t.Fatalf("public Catalog did not open exactly one read-only repeatable-read transaction: %+v", probe)
	}
	if probe.queries != 1 ||
		!strings.Contains(probe.lastQuery, "independent_store_publications") ||
		!strings.Contains(probe.lastQuery, "independent_store_customer_policies") ||
		!strings.Contains(probe.lastQuery, "store_profile_media_assets") {
		t.Fatalf("public Catalog queried offers or bypassed legal/publication/media gates: %+v", probe)
	}
	if probe.rollbacks != 1 || probe.commits != 0 {
		t.Fatalf("rejected Store must roll back without committing: %+v", probe)
	}
}

func TestIndependentPublicCatalogInvalidCursorDoesNotOpenTransaction(t *testing.T) {
	db, probe := newIndependentSnapshotProbeDB(t)
	_, err := ListPublishedIndependentOffers(context.Background(), db, "draft-store", "approved-legal-v1", 20, "not-base64url!")
	if !errors.Is(err, ErrCatalogOfferInvalidCursor) {
		t.Fatalf("malformed cursor must fail before DB operation: %v", err)
	}
	if probe.begins != 0 || probe.queries != 0 || probe.commits != 0 || probe.rollbacks != 0 {
		t.Fatalf("malformed cursor made a database call: %+v", probe)
	}
}
