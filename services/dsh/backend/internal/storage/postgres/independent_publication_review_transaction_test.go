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

type independentReviewProbe struct {
	state                   string
	version, writes, audits int
	key, requestHash        string
	lastVersion             int
}
type independentReviewDriver struct{ p *independentReviewProbe }
type independentReviewConn struct{ p *independentReviewProbe }
type independentReviewTx struct{}
type independentReviewRows struct {
	cols   []string
	values [][]driver.Value
}
type independentReviewResult int64

func (r independentReviewResult) LastInsertId() (int64, error) { return 0, errors.New("no insert ID") }
func (r independentReviewResult) RowsAffected() (int64, error) { return int64(r), nil }
func (d independentReviewDriver) Open(string) (driver.Conn, error) {
	return &independentReviewConn{p: d.p}, nil
}
func (*independentReviewConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (*independentReviewConn) Close() error              { return nil }
func (*independentReviewConn) Begin() (driver.Tx, error) { return independentReviewTx{}, nil }
func (independentReviewTx) Commit() error                { return nil }
func (independentReviewTx) Rollback() error              { return nil }
func (r independentReviewRows) Columns() []string        { return r.cols }
func (r independentReviewRows) Close() error             { return nil }
func (r *independentReviewRows) Next(dest []driver.Value) error {
	if len(r.values) == 0 {
		return io.EOF
	}
	copy(dest, r.values[0])
	r.values = r.values[1:]
	return nil
}
func (c *independentReviewConn) QueryContext(_ context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(q, "SELECT partner_actor_id FROM dsh.stores"):
		if !strings.Contains(q, "relation_model='INDEPENDENT_STORE'") || !strings.Contains(q, "FOR UPDATE") {
			return nil, errors.New("Store model/lock lost")
		}
		return &independentReviewRows{cols: []string{"partner_actor_id"}, values: [][]driver.Value{{"merchant-a"}}}, nil
	case strings.Contains(q, "SELECT state,version FROM dsh.independent_store_publications"):
		if !strings.Contains(q, "FOR UPDATE") {
			return nil, errors.New("publication CAS lock missing")
		}
		return &independentReviewRows{cols: []string{"state", "version"}, values: [][]driver.Value{{c.p.state, int64(c.p.version)}}}, nil
	case strings.Contains(q, "SELECT request_hash,result_version"):
		values := [][]driver.Value{}
		if c.p.key == args[0].Value && c.p.key != "" {
			values = append(values, []driver.Value{c.p.requestHash, int64(c.p.lastVersion)})
		}
		return &independentReviewRows{cols: []string{"request_hash", "result_version"}, values: values}, nil
	default:
		return nil, fmt.Errorf("unexpected review query %q", q)
	}
}
func (c *independentReviewConn) ExecContext(_ context.Context, q string, args []driver.NamedValue) (driver.Result, error) {
	switch {
	case strings.Contains(q, "UPDATE dsh.independent_store_publications"):
		if !strings.Contains(q, "published_at=NULL") || !strings.Contains(q, "review_reason=$4") ||
			args[5].Value != int64(c.p.version) || args[6].Value != c.p.state {
			return nil, errors.New("review write omitted CAS, reason or publication revocation")
		}
		c.p.state = args[1].Value.(string)
		c.p.version++
		c.p.writes++
		return independentReviewResult(1), nil
	case strings.Contains(q, "INSERT INTO dsh.independent_store_publication_idempotency"):
		c.p.key = args[0].Value.(string)
		c.p.requestHash = args[1].Value.(string)
		c.p.lastVersion = int(args[5].Value.(int64))
	case strings.Contains(q, "INSERT INTO dsh.independent_store_publication_audit"):
		c.p.audits++
	default:
		return nil, fmt.Errorf("unexpected review SQL %q", q)
	}
	return independentReviewResult(1), nil
}

var reviewDriverSeq atomic.Uint64

func newIndependentReviewDB(t *testing.T, p *independentReviewProbe) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("dsh-independent-review-%d", reviewDriverSeq.Add(1))
	sql.Register(name, independentReviewDriver{p: p})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// This database/sql transaction probe verifies CAS, audit cardinality and
// idempotency; PostgreSQL integration races require separate isolated QA.
func TestIndependentReviewDecisionCASIdempotencyAndAudit(t *testing.T) {
	ctx := context.Background()
	p := &independentReviewProbe{state: "NEEDS_REVIEW", version: 3}
	db := newIndependentReviewDB(t, p)
	reason := "Products require a corrected consumer-facing policy"
	key := strings.Repeat("k", 20)
	first, err := DecideIndependentPublicationReview(ctx, db, "store-a", "operator-a",
		"RETURN_FOR_CORRECTION", reason, 3, key, "correlation-one")
	if err != nil || first.State != "NEEDS_CORRECTION" || first.ReviewState != "REJECTED" ||
		first.Version != 4 || p.audits != 1 || p.writes != 1 {
		t.Fatalf("review decision must persist once: %+v err=%v p=%+v", first, err, p)
	}
	replay, err := DecideIndependentPublicationReview(ctx, db, "store-a", "operator-a",
		"RETURN_FOR_CORRECTION", reason, 3, key, "correlation-one")
	if err != nil || !replay.IdempotentReplay || replay.Version != 4 || p.audits != 1 || p.writes != 1 {
		t.Fatalf("replay must not duplicate event: %+v err=%v p=%+v", replay, err, p)
	}
	_, err = DecideIndependentPublicationReview(ctx, db, "store-a", "operator-a",
		"RETURN_FOR_CORRECTION", "Different correction is now required", 3, key, "correlation-one")
	if !errors.Is(err, ErrIndependentPublicationReviewReplay) {
		t.Fatalf("reused key must conflict: %v", err)
	}
	_, err = DecideIndependentPublicationReview(ctx, db, "store-a", "operator-a",
		"REJECT", reason, 3, strings.Repeat("q", 20), "correlation-two")
	if !errors.Is(err, ErrIndependentPublicationReviewVersion) {
		t.Fatalf("stale CAS must fail: %v", err)
	}
	if p.audits != 1 || p.writes != 1 {
		t.Fatalf("stale attempts mutated persisted state: %+v", p)
	}
}
func TestIndependentSuspensionReopenRequiresExplicitOperatorDecision(t *testing.T) {
	p := &independentReviewProbe{state: "SUSPENDED", version: 9}
	db := newIndependentReviewDB(t, p)
	got, err := DecideIndependentPublicationReview(context.Background(), db, "store-a", "operator-a",
		"REOPEN_SUSPENSION_FOR_CORRECTION", "Operator authorizes corrective resubmission", 9,
		strings.Repeat("r", 20), "correlation-reopen")
	if err != nil || got.State != "NEEDS_CORRECTION" || got.ReviewState != "REJECTED" ||
		p.writes != 1 || p.audits != 1 {
		t.Fatalf("suspended Store must only reopen to private correction: %+v err=%v p=%+v", got, err, p)
	}
}
