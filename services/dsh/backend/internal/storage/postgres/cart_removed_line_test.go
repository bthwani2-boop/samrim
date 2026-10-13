package postgres

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"
)

// A read-only SQL fixture that returns a deleted cart line if the queried SQL
// fails to exclude it. No PostgreSQL connection or shared state is required.
type removedLineConnector struct{ connection *removedLineConnection }

func (c removedLineConnector) Connect(context.Context) (driver.Conn, error) {
	return c.connection, nil
}

func (c removedLineConnector) Driver() driver.Driver { return removedLineDriver{} }

type removedLineDriver struct{}

func (removedLineDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("use the isolated removed-line connector")
}

type removedLineConnection struct {
	lineLookups   int
	unexpectedSQL int
}

func (c *removedLineConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepared statement")
}

func (c *removedLineConnection) Close() error { return nil }

func (c *removedLineConnection) Begin() (driver.Tx, error) { return removedLineTx{}, nil }

func (c *removedLineConnection) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return removedLineTx{}, nil
}

func (c *removedLineConnection) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if strings.Contains(query, "pg_advisory_xact_lock") {
		return driver.RowsAffected(0), nil
	}
	c.unexpectedSQL++
	return nil, fmt.Errorf("deleted cart line must never trigger mutation: %s", query)
}

func (c *removedLineConnection) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "commerce_cart_mutation_idempotency") {
		// New idempotency key: perform the canonical active-line lookup.
		return &removedLineRows{columns: []string{"request_hash", "cart_id", "operation"}}, nil
	}
	if strings.Contains(query, "FROM dsh.commerce_cart_lines l JOIN dsh.commerce_carts c") {
		c.lineLookups++
		columns := []string{"id", "store_id", "state", "version", "created_at", "updated_at"}
		if strings.Contains(query, "l.store_offer_id") {
			columns = append(columns, "store_offer_id")
		}
		rows := &removedLineRows{columns: columns}
		// Simulate a persisted line whose removed_at is non-NULL. A query with
		// the active-line predicate must return no records.
		if !strings.Contains(query, "l.removed_at IS NULL") {
			now := time.Now().UTC()
			rows.values = [][]driver.Value{{"cart-1", "store-1", "open", int64(1), now, now}}
			if len(columns) == 7 {
				rows.values[0] = append(rows.values[0], "offer-1")
			}
		}
		return rows, nil
	}
	c.unexpectedSQL++
	return nil, fmt.Errorf("unexpected SQL during removed-line guard: %s", query)
}

type removedLineTx struct{}

func (removedLineTx) Commit() error   { return nil }
func (removedLineTx) Rollback() error { return nil }

type removedLineRows struct {
	columns []string
	values  [][]driver.Value
	next    int
}

func (r *removedLineRows) Columns() []string { return r.columns }
func (r *removedLineRows) Close() error      { return nil }
func (r *removedLineRows) Next(dest []driver.Value) error {
	if r.next >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.next])
	r.next++
	return nil
}

func TestCartLineMutationRejectsRemovedLineBeforeWrite(t *testing.T) {
	for _, operation := range []string{"update", "remove"} {
		t.Run(operation, func(t *testing.T) {
			conn := &removedLineConnection{}
			db := sql.OpenDB(removedLineConnector{connection: conn})
			t.Cleanup(func() { _ = db.Close() })
			var replayed bool
			var err error
			switch operation {
			case "update":
				_, replayed, err = UpdateCartLine(context.Background(), db, "client-1", "line-removed", 2, nil, 1, "new-key", "new-hash", "client-1", "corr")
			case "remove":
				_, replayed, err = RemoveCartLine(context.Background(), db, "client-1", "line-removed", 1, "new-key", "new-hash", "client-1", "corr")
			}
			if !errors.Is(err, ErrCartNotFound) {
				t.Fatalf("operation %s on deleted line error = %v, want ErrCartNotFound", operation, err)
			}
			if replayed {
				t.Fatal("deleted cart line cannot be replayed under a new idempotency key")
			}
			if conn.lineLookups != 1 || conn.unexpectedSQL != 0 {
				t.Fatalf("line lookups = %d, unexpected SQL writes/reads = %d; want 1 and 0", conn.lineLookups, conn.unexpectedSQL)
			}
		})
	}
}
