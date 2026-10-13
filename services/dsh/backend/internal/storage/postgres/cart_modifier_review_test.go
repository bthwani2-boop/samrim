package postgres

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

// Read-only driver: the attached modifier group was deactivated by the partner,
// but the previously chosen option remains in an otherwise readable cart line.
type cartReviewConnector struct{ conn *cartReviewConn }

func (c cartReviewConnector) Connect(context.Context) (driver.Conn, error) { return c.conn, nil }
func (c cartReviewConnector) Driver() driver.Driver                        { return removedLineDriver{} }

type cartReviewConn struct {
	selectedOptions string
	lineQueries     int
	groupQueries    int
}

func (c *cartReviewConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepared statement")
}
func (c *cartReviewConn) Close() error              { return nil }
func (c *cartReviewConn) Begin() (driver.Tx, error) { return removedLineTx{}, nil }

func (c *cartReviewConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	switch {
	case strings.Contains(query, "FROM dsh.commerce_cart_lines l"):
		c.lineQueries++
		now := time.Now().UTC()
		return &removedLineRows{
			columns: []string{"id", "cart_id", "store_offer_id", "variant_id", "product_id", "canonical_name", "title", "measurement_kind", "base_unit", "pricing_basis", "quantity_policy", "quantity_min_base_units", "quantity_max_base_units", "quantity_step_base_units", "pricing_unit_base_units", "quantity_base_units", "selected_modifier_option_ids", "price_minor", "currency", "version", "created_at", "updated_at"},
			values:  [][]driver.Value{{"line-1", "cart-1", "offer-1", "variant-1", "product-1", "منتج", "حجم", "COUNT", "PIECE", "PER_UNIT", "DISCRETE", int64(1), int64(100), int64(1), int64(1), int64(3), c.selectedOptions, int64(100), "YER", int64(1), now, now}},
		}, nil
	case strings.Contains(query, "FROM dsh.catalog_store_offer_modifier_groups"):
		c.groupQueries++
		// A formerly selected modifier group is now inactive and hidden
		// by the canonical WHERE g.active=true predicate.
		return &removedLineRows{columns: []string{"id", "store_id", "name_ar", "required", "min_selections", "max_selections", "active", "version"}}, nil
	default:
		return nil, fmt.Errorf("unexpected SQL in cart review fixture: %s", query)
	}
}

func TestCartReadKeepsInvalidModifierLineRemovableWithoutQuotingPrice(t *testing.T) {
	for _, tc := range []struct {
		name           string
		selected       string
		requiresReview bool
	}{
		{name: "former option group is now inactive", selected: "{option-1}", requiresReview: true},
		{name: "valid cart without attached modifier groups", selected: "{}", requiresReview: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conn := &cartReviewConn{selectedOptions: tc.selected}
			db := sql.OpenDB(cartReviewConnector{conn: conn})
			t.Cleanup(func() { _ = db.Close() })
			lines, err := listCartLines(context.Background(), db, "cart-1")
			if err != nil {
				t.Fatalf("read cart lines: %v", err)
			}
			if len(lines) != 1 || lines[0].RequiresReview != tc.requiresReview {
				t.Fatalf("lines=%+v, requiresReview want %t", lines, tc.requiresReview)
			}
			if lines[0].LineAmountMinor != 300 || lines[0].UnitPriceMinor != 100 {
				t.Fatalf("base price facts not preserved: %+v", lines[0])
			}
			if lines[0].SelectedModifiers == nil {
				t.Fatal("response must preserve the non-null modifier array contract")
			}
			if conn.lineQueries != 1 || conn.groupQueries != 1 {
				t.Fatalf("unexpected read queries: lines=%d groups=%d", conn.lineQueries, conn.groupQueries)
			}
		})
	}
}
