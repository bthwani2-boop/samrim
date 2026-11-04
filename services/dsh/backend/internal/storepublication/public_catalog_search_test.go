package storepublication

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"testing"
	"time"
)

var errCatalogDeadlineProbe = errors.New("catalog deadline probe")

type catalogDeadlineConnector struct{ observed *time.Duration }

func (c catalogDeadlineConnector) Connect(context.Context) (driver.Conn, error) {
	return catalogDeadlineConn{observed: c.observed}, nil
}

func (c catalogDeadlineConnector) Driver() driver.Driver {
	return catalogDeadlineDriver{observed: c.observed}
}

type catalogDeadlineDriver struct{ observed *time.Duration }

func (d catalogDeadlineDriver) Open(string) (driver.Conn, error) {
	return catalogDeadlineConn{observed: d.observed}, nil
}

type catalogDeadlineConn struct{ observed *time.Duration }

func (catalogDeadlineConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected SQL prepare")
}
func (catalogDeadlineConn) Close() error { return nil }
func (catalogDeadlineConn) Begin() (driver.Tx, error) {
	return nil, errors.New("unexpected SQL transaction")
}

func (c catalogDeadlineConn) QueryContext(ctx context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	deadline, ok := ctx.Deadline()
	if !ok {
		return nil, errors.New("catalog query has no execution deadline")
	}
	*c.observed = time.Until(deadline)
	return nil, errCatalogDeadlineProbe
}

func TestPublicCatalogSearchBoundsSQLWorkAndRespectsCallerDeadline(t *testing.T) {
	for _, tc := range []struct {
		name    string
		parent  time.Duration
		maximum time.Duration
	}{
		{name: "default search budget", maximum: 8 * time.Second},
		{name: "caller has earlier deadline", parent: 250 * time.Millisecond, maximum: 250 * time.Millisecond},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var observed time.Duration
			db := sql.OpenDB(catalogDeadlineConnector{observed: &observed})
			t.Cleanup(func() { _ = db.Close() })
			ctx := context.Background()
			if tc.parent > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, tc.parent)
				defer cancel()
			}
			_, err := (&Service{db: db}).SearchPublicCatalog(ctx, "sanaa", "", "", "!!!", 20, "")
			if !errors.Is(err, errCatalogDeadlineProbe) {
				t.Fatalf("the SQL path did not run under its deadline: %v", err)
			}
			if observed <= 0 || observed > tc.maximum {
				t.Fatalf("unexpected effective query execution budget: got %v, want within (0, %v]", observed, tc.maximum)
			}
		})
	}
}
