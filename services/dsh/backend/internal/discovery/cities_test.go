package discovery

import (
	"context"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestCityDirectoryRejectsOutOfContractQueriesBeforeOwnerRead(t *testing.T) {
	for _, query := range []string{"limit=51", "cursor=first&cursor=second", "cursor=", "city_id=aden", "%GG=1"} {
		w := httptest.NewRecorder()
		(&Server{}).ServeHTTP(w, httptest.NewRequest("GET", "/v1/public/cities?"+query, nil))
		if w.Code != 400 {
			t.Fatalf("invalid query %q returned %d", query, w.Code)
		}
	}
}

func TestOwnerBackedActiveCityDirectory(t *testing.T) {
	owner, server := setupIntegratedOwner(t)
	ctx := context.Background()
	setActive := func(active bool) error {
		tx, err := dbscope.Begin(ctx, owner.DB, owner.Schema, nil, "service_cities", "public_revision")
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err = tx.ExecContext(ctx, "UPDATE service_cities SET active=$1 WHERE id='sanaa'", active); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE public_revision SET revision=revision+1 WHERE singleton"); err != nil {
			return err
		}
		return tx.Commit()
	}
	t.Cleanup(func() {
		if err := setActive(true); err != nil {
			t.Errorf("restore synthetic city: %v", err)
		}
	})
	const route = "/v1/public/cities"
	w, body := request(server, route+"?limit=1")
	items := results(t, body)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || len(items) != 1 || items[0] != "aden" {
		t.Fatalf("bad first city page: %d %s", w.Code, w.Body.String())
	}
	cursor, ok := body["nextCursor"].(string)
	if !ok || cursor == "" {
		t.Fatal("missing city cursor")
	}
	continuation := "?limit=1&cursor=" + url.QueryEscape(cursor)
	w, body = request(server, route+continuation)
	items = results(t, body)
	if w.Code != 200 || len(items) != 1 || items[0] != "sanaa" || body["nextCursor"] != nil {
		t.Fatalf("bad second city page: %d %s", w.Code, w.Body.String())
	}
	w, _ = request(server, "/v1/public/verticals"+continuation+"&city_id=aden")
	if w.Code != 400 {
		t.Fatalf("city cursor crossed into another directory: %d", w.Code)
	}
	if err := setActive(false); err != nil {
		t.Fatal(err)
	}
	w, body = request(server, route+continuation)
	if w.Code != 409 || body["error"] != "STALE_CURSOR" {
		t.Fatalf("old city cursor survived the owner revision: %d %s", w.Code, w.Body.String())
	}
	w, body = request(server, route)
	items = results(t, body)
	if w.Code != 200 || len(items) != 1 || items[0] != "aden" {
		t.Fatalf("inactive city exposed: %d %s", w.Code, w.Body.String())
	}
}
