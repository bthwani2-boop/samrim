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

func TestIndependentPublicationSubmitRequiresLegalVersionAndScopedInputs(t *testing.T) {
	for _, test := range []struct {
		name, storeID, owner, terms, key string
		version                          int
	}{
		{"missing store", "", "owner-a", "approved-v1", strings.Repeat("k", 16), 1},
		{"missing owner", "store-a", "", "approved-v1", strings.Repeat("k", 16), 1},
		{"missing approved terms", "store-a", "owner-a", "", strings.Repeat("k", 16), 1},
		{"future version", "store-a", "owner-a", "approved-v1", strings.Repeat("k", 16), 0},
		{"short replay key", "store-a", "owner-a", "approved-v1", "key", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := SubmitIndependentPublicationForOwner(context.Background(), nil,
				test.storeID, test.owner, test.terms, test.version, test.key, "correlation-a")
			if !errors.Is(err, ErrIndependentPublicationSubmitInvalid) {
				t.Fatalf("invalid submission must fail: %v", err)
			}
		})
	}
}

type submissionProbe struct {
	owner             string
	state             string
	version           int
	missing           bool
	key, hash         string
	lastResultVersion int
	policy            bool
	writes, audits    int
}
type submissionDriver struct{ probe *submissionProbe }
type submissionConn struct{ probe *submissionProbe }
type submissionTx struct{}
type submissionRows struct {
	columns []string
	values  [][]driver.Value
}
type submissionWriteResult struct{}

func (submissionWriteResult) LastInsertId() (int64, error) { return 0, errors.New("unavailable") }
func (submissionWriteResult) RowsAffected() (int64, error) { return 1, nil }
func (d submissionDriver) Open(string) (driver.Conn, error) {
	return &submissionConn{probe: d.probe}, nil
}
func (*submissionConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected Prepare")
}
func (*submissionConn) Close() error              { return nil }
func (*submissionConn) Begin() (driver.Tx, error) { return submissionTx{}, nil }
func (submissionTx) Commit() error                { return nil }
func (submissionTx) Rollback() error              { return nil }
func (r submissionRows) Columns() []string        { return r.columns }
func (r submissionRows) Close() error             { return nil }
func (r *submissionRows) Next(dst []driver.Value) error {
	if len(r.values) == 0 {
		return io.EOF
	}
	copy(dst, r.values[0])
	r.values = r.values[1:]
	return nil
}
func (c *submissionConn) QueryContext(_ context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(q, "SELECT partner_actor_id FROM dsh.stores"):
		if !strings.Contains(q, "relation_model='INDEPENDENT_STORE'") || !strings.Contains(q, "FOR UPDATE") {
			return nil, errors.New("missing owner/relation lock")
		}
		return &submissionRows{columns: []string{"partner_actor_id"}, values: [][]driver.Value{{c.probe.owner}}}, nil
	case strings.Contains(q, "SELECT state,version FROM dsh.independent_store_publications"):
		if !strings.Contains(q, "FOR UPDATE") {
			return nil, errors.New("missing publication lock")
		}
		values := [][]driver.Value{}
		if !c.probe.missing {
			values = append(values, []driver.Value{c.probe.state, int64(c.probe.version)})
		}
		return &submissionRows{columns: []string{"state", "version"}, values: values}, nil
	case strings.Contains(q, "SELECT request_hash,result_version"):
		values := [][]driver.Value{}
		if c.probe.key != "" && c.probe.key == args[0].Value {
			values = append(values, []driver.Value{c.probe.hash, int64(c.probe.lastResultVersion)})
		}
		return &submissionRows{columns: []string{"request_hash", "result_version"}, values: values}, nil
	case strings.Contains(q, "SELECT EXISTS("):
		if !strings.Contains(q, "independent_store_customer_policies") || !strings.Contains(q, "authored_by_actor_id=$2") {
			return nil, errors.New("merchant policy ownership check missing")
		}
		return &submissionRows{columns: []string{"exists"}, values: [][]driver.Value{{c.probe.policy}}}, nil
	default:
		return nil, fmt.Errorf("unexpected submission query %s", q)
	}
}
func (c *submissionConn) ExecContext(_ context.Context, q string, args []driver.NamedValue) (driver.Result, error) {
	switch {
	case strings.Contains(q, "INSERT INTO dsh.independent_store_publications"):
		if !strings.Contains(q, "'NEEDS_REVIEW'") || !strings.Contains(q, "terms_accepted_by_actor_id") {
			return nil, errors.New("submission must not publish or omit consent")
		}
		c.probe.state = "NEEDS_REVIEW"
		c.probe.version = int(args[1].Value.(int64))
		c.probe.missing = false
		c.probe.writes++
	case strings.Contains(q, "UPDATE dsh.independent_store_publications"):
		if !strings.Contains(q, "state='NEEDS_REVIEW'") || !strings.Contains(q, "review_state='NEEDS_REVIEW'") || !strings.Contains(q, "published_at=NULL") {
			return nil, errors.New("update must be review-only with no public publication")
		}
		c.probe.state = "NEEDS_REVIEW"
		c.probe.version++
		c.probe.writes++
	case strings.Contains(q, "INSERT INTO dsh.independent_store_publication_idempotency"):
		c.probe.key = args[0].Value.(string)
		c.probe.hash = args[1].Value.(string)
		c.probe.lastResultVersion = int(args[4].Value.(int64))
	case strings.Contains(q, "INSERT INTO dsh.independent_store_publication_audit"):
		if !strings.Contains(q, "OWNER_SUBMITTED_FOR_REVIEW") {
			return nil, errors.New("wrong audit reason")
		}
		c.probe.audits++
	default:
		return nil, fmt.Errorf("unexpected submission write %s", q)
	}
	return submissionWriteResult{}, nil
}

var submitDriverSeq atomic.Uint64

func submissionTestDB(t *testing.T, p *submissionProbe) *sql.DB {
	t.Helper()
	name := fmt.Sprintf("dsh-submission-%d", submitDriverSeq.Add(1))
	sql.Register(name, submissionDriver{probe: p})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// Test the canonical transaction sequence without writing to shared PostgreSQL.
func TestIndependentPublicationSubmitOwnerCASReplayAndSuspensionGuard(t *testing.T) {
	ctx := context.Background()
	const reason = "approved-terms-v1"
	key := strings.Repeat("k", 20)
	p := &submissionProbe{owner: "owner-a", state: "DRAFT", version: 1, missing: true, policy: true}
	db := submissionTestDB(t, p)
	receipt, err := SubmitIndependentPublicationForOwner(ctx, db, "store-a", "owner-a", reason, 1, key, "correlation-one")
	if err != nil || receipt.StoreID != "store-a" || receipt.State != "NEEDS_REVIEW" || receipt.Version != 2 ||
		p.writes != 1 || p.audits != 1 {
		t.Fatalf("first submission failed: %+v err=%v probe=%+v", receipt, err, p)
	}
	replay, err := SubmitIndependentPublicationForOwner(ctx, db, "store-a", "owner-a", reason, 1, key, "correlation-one")
	if err != nil || !replay.IdempotentReplay || replay.Version != 2 || p.writes != 1 || p.audits != 1 {
		t.Fatalf("idempotent replay must not duplicate audit: %+v err=%v probe=%+v", replay, err, p)
	}
	_, err = SubmitIndependentPublicationForOwner(ctx, db, "store-a", "owner-a", "different-v2", 1, key, "correlation-one")
	if !errors.Is(err, ErrIndependentPublicationSubmitReplay) {
		t.Fatalf("changed Terms with reused key must conflict: %v", err)
	}
	_, err = SubmitIndependentPublicationForOwner(ctx, db, "store-a", "owner-a", reason, 1, strings.Repeat("q", 20), "correlation-two")
	if !errors.Is(err, ErrIndependentPublicationSubmitVersion) {
		t.Fatalf("stale owner version must conflict: %v", err)
	}
	p.state = "SUSPENDED"
	_, err = SubmitIndependentPublicationForOwner(ctx, db, "store-a", "owner-a", reason, 2, strings.Repeat("x", 20), "correlation-three")
	if !errors.Is(err, ErrIndependentPublicationSubmitState) {
		t.Fatalf("suspension cannot be bypassed by resubmit: %v", err)
	}
	p.owner = "owner-b"
	_, err = SubmitIndependentPublicationForOwner(ctx, db, "store-a", "owner-a", reason, 2, strings.Repeat("y", 20), "correlation-four")
	if !errors.Is(err, ErrStoreNotFound) {
		t.Fatalf("other Store owner cannot submit: %v", err)
	}
}
