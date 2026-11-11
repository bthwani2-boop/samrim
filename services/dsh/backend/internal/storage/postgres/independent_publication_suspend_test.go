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

func TestIndependentSuspensionRefusesUntrustedInput(t *testing.T) {
	for _, tc := range []struct {
		name, storeID, actor, reason, key, correlation string
		expected                                       int
	}{
		{"missing Store", "", "operator-a", "Serious consumer abuse", strings.Repeat("k", 16), "correlation", 1},
		{"empty reason", "store-a", "operator-a", "", strings.Repeat("k", 16), "correlation", 1},
		{"too short reason", "store-a", "operator-a", "short", strings.Repeat("k", 16), "correlation", 1},
		{"spoofed version", "store-a", "operator-a", "Serious consumer abuse", strings.Repeat("k", 16), "correlation", 0},
		{"short attempt", "store-a", "operator-a", "Serious consumer abuse", "short", "correlation", 1},
		{"control in reason", "store-a", "operator-a", "Serious\x00abuse", strings.Repeat("k", 16), "correlation", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if validIndependentSuspension(tc.storeID, tc.actor, tc.reason, tc.key, tc.correlation, tc.expected) {
				t.Fatal("invalid suspension input was accepted")
			}
		})
	}
	if _, err := SuspendIndependentPublication(context.Background(), nil, "store-a", "operator-a", "Serious consumer abuse", 1, strings.Repeat("k", 16), "correlation"); !errors.Is(err, ErrIndependentPublicationSuspendInvalid) {
		t.Fatalf("nil DB must fail closed: %v", err)
	}
}

type suspensionProbe struct {
	state                string
	version              int
	updates              int
	audits               int
	keyHash, requestHash string
	idemVersion          int
	queried              []string
}
type suspensionDriver struct{ probe *suspensionProbe }
type suspensionConn struct{ probe *suspensionProbe }
type suspensionTx struct{}
type suspensionRows struct {
	columns []string
	data    [][]driver.Value
}
type suspensionResult int64

func (s suspensionResult) LastInsertId() (int64, error) { return 0, errors.New("no insert ID") }
func (s suspensionResult) RowsAffected() (int64, error) { return int64(s), nil }
func (d suspensionDriver) Open(string) (driver.Conn, error) {
	return &suspensionConn{probe: d.probe}, nil
}
func (c *suspensionConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c *suspensionConn) Close() error              { return nil }
func (c *suspensionConn) Begin() (driver.Tx, error) { return suspensionTx{}, nil }
func (s suspensionTx) Commit() error                { return nil }
func (s suspensionTx) Rollback() error              { return nil }
func (r suspensionRows) Columns() []string          { return r.columns }
func (r suspensionRows) Close() error               { return nil }
func (r *suspensionRows) Next(dest []driver.Value) error {
	if len(r.data) == 0 {
		return io.EOF
	}
	copy(dest, r.data[0])
	r.data = r.data[1:]
	return nil
}
func (c *suspensionConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.probe.queried = append(c.probe.queried, query)
	switch {
	case strings.Contains(query, "SELECT partner_actor_id FROM dsh.stores"):
		if !strings.Contains(query, "relation_model='INDEPENDENT_STORE'") || !strings.Contains(query, "FOR UPDATE") {
			return nil, errors.New("Store relation/lock bypass")
		}
		return &suspensionRows{columns: []string{"partner_actor_id"}, data: [][]driver.Value{{"merchant-a"}}}, nil
	case strings.Contains(query, "SELECT state,version FROM dsh.independent_store_publications"):
		if !strings.Contains(query, "FOR UPDATE") {
			return nil, errors.New("publication lock missing")
		}
		return &suspensionRows{columns: []string{"state", "version"}, data: [][]driver.Value{{c.probe.state, int64(c.probe.version)}}}, nil
	case strings.Contains(query, "SELECT request_hash,result_version"):
		if c.probe.keyHash == "" || c.probe.keyHash != args[0].Value {
			return &suspensionRows{columns: []string{"request_hash", "result_version"}}, nil
		}
		return &suspensionRows{columns: []string{"request_hash", "result_version"}, data: [][]driver.Value{{c.probe.requestHash, int64(c.probe.idemVersion)}}}, nil
	default:
		return nil, fmt.Errorf("unexpected suspension query %q", query)
	}
}
func (c *suspensionConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	switch {
	case strings.Contains(query, "UPDATE dsh.independent_store_publications"):
		if !strings.Contains(query, "review_state='NEEDS_REVIEW'") || !strings.Contains(query, "published_at=NULL") ||
			!strings.Contains(query, "state='SUSPENDED'") || args[2].Value != int64(c.probe.version) {
			return nil, errors.New("suspension must revoke approval with CAS")
		}
		c.probe.state = "SUSPENDED"
		c.probe.version++
		c.probe.updates++
		return suspensionResult(1), nil
	case strings.Contains(query, "INSERT INTO dsh.independent_store_publication_idempotency"):
		c.probe.keyHash = args[0].Value.(string)
		c.probe.requestHash = args[1].Value.(string)
		c.probe.idemVersion = int(args[4].Value.(int64))
		return suspensionResult(1), nil
	case strings.Contains(query, "INSERT INTO dsh.independent_store_publication_audit"):
		c.probe.audits++
		return suspensionResult(1), nil
	default:
		return nil, fmt.Errorf("unexpected suspension write %q", query)
	}
}

var suspendTestDriverSequence atomic.Uint64

// A database/sql transaction probe exercises real service and driver calls
// without mutating the shared DSH database. Real PostgreSQL lock races remain
// a separate isolated QA proof.
func TestIndependentSuspensionCASIdempotencyAndSingleAudit(t *testing.T) {
	probe := &suspensionProbe{state: "PUBLISHED_INDEPENDENT", version: 7}
	name := fmt.Sprintf("dsh-independent-suspend-probe-%d", suspendTestDriverSequence.Add(1))
	sql.Register(name, suspensionDriver{probe: probe})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	key := strings.Repeat("k", 24)
	reason := "Documented harmful Store content"
	first, err := SuspendIndependentPublication(ctx, db, "store-a", "operator-a", reason, 7, key, "correlation-one")
	if err != nil || first.StoreID != "store-a" || first.Version != 8 || first.State != "SUSPENDED" || first.IdempotentReplay {
		t.Fatalf("first operator suspension did not persist: %+v %v", first, err)
	}
	if probe.updates != 1 || probe.audits != 1 || probe.state != "SUSPENDED" {
		t.Fatalf("incomplete suspension: %+v", probe)
	}
	replay, err := SuspendIndependentPublication(ctx, db, "store-a", "operator-a", reason, 7, key, "correlation-one")
	if err != nil || !replay.IdempotentReplay || replay.Version != 8 || probe.updates != 1 || probe.audits != 1 {
		t.Fatalf("exact replay must be read-only: %+v %v probe=%+v", replay, err, probe)
	}
	_, err = SuspendIndependentPublication(ctx, db, "store-a", "operator-a", "Different reason is prohibited", 7, key, "correlation-one")
	if !errors.Is(err, ErrIndependentPublicationSuspendReplay) || probe.updates != 1 || probe.audits != 1 {
		t.Fatalf("key reuse with changed facts must conflict: %v %+v", err, probe)
	}
	_, err = SuspendIndependentPublication(ctx, db, "store-a", "operator-a", reason, 7, strings.Repeat("j", 24), "correlation-two")
	if !errors.Is(err, ErrIndependentPublicationSuspendVersion) || probe.updates != 1 || probe.audits != 1 {
		t.Fatalf("different attempt with stale CAS must conflict: %v %+v", err, probe)
	}
}
