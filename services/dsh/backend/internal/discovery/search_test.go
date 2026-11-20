package discovery

import (
	"context"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestStoreSearchValidationAndCursorScope(t *testing.T) {
	for _, q := range []string{"متجر", "%_", "' OR true --", strings.Repeat("😀", 76)} {
		r := httptest.NewRequest("GET", "/v1/public/stores?city_id=sanaa&q="+url.QueryEscape("  "+q+"  "), nil)
		got, scope, ok := publicSearch(r, "sanaa")
		if !ok || got != q {
			t.Fatalf("search %q: %q %v", q, got, ok)
		}
		cursor := makeCursor(pageCursor{Kind: "stores", Scope: scope, After: "store-a", Revision: 1})
		if len(cursor) > 512 {
			t.Fatal("unusable search cursor")
		}
		if _, err := parseCursor(cursor, "stores", scope, 1); err != nil {
			t.Fatal(err)
		}
		if _, err := parseCursor(cursor, "stores", "sanaa", 1); err == nil {
			t.Fatal("search cursor reused for another query")
		}
	}
	for _, raw := range []string{"q=a&q=b", "q=" + strings.Repeat("a", 81), "q=+" + strings.Repeat("a", 80), "q=" + strings.Repeat("+", 81), "q=%00", "q=%FF", "q=%ZZ"} {
		w := httptest.NewRecorder()
		(&Server{}).ServeHTTP(w, httptest.NewRequest("GET", "/v1/public/stores?city_id=sanaa&"+raw, nil))
		if w.Code != 400 || !strings.Contains(w.Body.String(), "INVALID_SEARCH") {
			t.Fatalf("bad search %q: %d %s", raw, w.Code, w.Body.String())
		}
	}
	_, scope, ok := publicSearch(httptest.NewRequest("GET", "/v1/public/stores?city_id=sanaa&q=+", nil), "sanaa")
	if !ok || scope != "sanaa" {
		t.Fatal("empty search must preserve old cursors")
	}
}

func TestOwnerBackedStoreSearch(t *testing.T) {
	_, s := setupIntegratedOwner(t)
	for _, tc := range []struct {
		query string
		count int
	}{
		{"متجر", 2}, {" أ ", 1}, {"مباشر", 0}, {"مسودة", 0}, {"عدن", 0}, {"غير مسموح", 0}, {"%", 0}, {"_", 0}, {"' OR true --", 0},
	} {
		w, body := request(s, "/v1/public/stores?city_id=sanaa&q="+url.QueryEscape(tc.query))
		if w.Code != 200 || len(results(t, body)) != tc.count {
			t.Fatalf("search %q: %d %s", tc.query, w.Code, w.Body.String())
		}
	}
	path := "/v1/public/stores?city_id=sanaa&limit=1&q=" + url.QueryEscape("متجر")
	w, body := request(s, path)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	cursor, ok := body["nextCursor"].(string)
	if !ok {
		t.Fatal("missing search cursor")
	}
	w, body = request(s, path+"&cursor="+url.QueryEscape(cursor))
	if w.Code != 200 || len(results(t, body)) != 1 || results(t, body)[0].(map[string]any)["id"] != "market-sanaa-paused" {
		t.Fatalf("search pagination: %s", w.Body.String())
	}
	for _, path := range []string{"/v1/public/stores?city_id=sanaa", "/v1/public/stores?city_id=aden&q=" + url.QueryEscape("متجر"), "/v1/public/stores?city_id=sanaa&q=" + url.QueryEscape("أ")} {
		w, _ = request(s, path+"&cursor="+url.QueryEscape(cursor))
		if w.Code != 400 {
			t.Fatalf("cross-search/city cursor: %d %s", w.Code, w.Body.String())
		}
	}
}

func TestOfferSearchRejectsInvalidWireTextBeforeOwnerRead(t *testing.T) {
	for _, raw := range []string{"q=a&q=b", "q=" + strings.Repeat("a", 81), "q=+" + strings.Repeat("a", 80), "q=" + strings.Repeat("+", 81), "q=%00", "q=%FF", "q=%ZZ"} {
		w := httptest.NewRecorder()
		(&Server{}).ServeHTTP(w, httptest.NewRequest("GET", "/v1/public/stores/market-sanaa/offers?"+raw, nil))
		if w.Code != 400 || !strings.Contains(w.Body.String(), "INVALID_SEARCH") {
			t.Fatalf("bad Offer search %q: %d %s", raw, w.Code, w.Body.String())
		}
	}
}

func TestOfferSearchCursorScopeAndBlankCompatibility(t *testing.T) {
	for _, search := range []string{"دقيق", "%_", "' OR true --", strings.Repeat("😀", 80)} {
		r := httptest.NewRequest("GET", "/v1/public/stores/store-a/offers?q="+url.QueryEscape(search), nil)
		text, scope, valid := publicSearch(r, "store-a")
		if !valid || text != search {
			t.Fatalf("Offer search text rejected: %q", search)
		}
		cursor := makeCursor(pageCursor{Kind: "offers", Scope: scope, After: "offer-one", Revision: 4})
		if len(cursor) > 512 {
			t.Fatal("search cursor exceeded contract bound")
		}
		if _, err := parseCursor(cursor, "offers", scope, 4); err != nil {
			t.Fatal(err)
		}
		for _, other := range []string{"store-a", "store-b", "store-b" + strings.TrimPrefix(scope, "store-a")} {
			if _, err := parseCursor(cursor, "offers", other, 4); err == nil {
				t.Fatal("Offer cursor crossed Store/search scope")
			}
		}
		if _, err := parseCursor(cursor, "offers", scope, 5); err != errStale {
			t.Fatal("Offer cursor crossed catalog revision")
		}
	}
	legacy := makeCursor(pageCursor{Kind: "offers", Scope: "store-a", After: "offer-one", Revision: 4})
	for _, raw := range []string{"", "?q=", "?q=+++"} {
		text, scope, valid := publicSearch(httptest.NewRequest("GET", "/v1/public/stores/store-a/offers"+raw, nil), "store-a")
		if !valid || text != "" || scope != "store-a" {
			t.Fatal("blank query changed existing cursor scope")
		}
		if _, err := parseCursor(legacy, "offers", scope, 4); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOwnerBackedOfferSearch(t *testing.T) {
	owner, s := setupIntegratedOwner(t)
	ctx := context.Background()
	t.Cleanup(func() {
		if err := owner.ImportSynthetic(ctx); err != nil {
			t.Error(err)
		}
	})
	// Name changes are test-owned, explicitly isolated DSH synthetic state; no
	// public writer, external catalogue or persistent user Store is involved.
	mutate := func(query string) {
		t.Helper()
		tx, err := owner.beginScopedTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if _, err = tx.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	mutate("UPDATE products SET name=CASE id WHEN 'p-flour' THEN 'Flour دقيق' WHEN 'p-water' THEN 'flour ماء' ELSE name END WHERE store_id='market-sanaa'")
	for _, tc := range []struct {
		search string
		count  int
	}{
		{"flour", 2}, {"FLOUR", 2}, {" دقيق ", 1}, {"ماء", 1}, {"غير منشور", 0}, {"نفدت", 0}, {"%", 0}, {"_", 0}, {"' OR true --", 0},
	} {
		w, body := request(s, "/v1/public/stores/market-sanaa/offers?q="+url.QueryEscape(tc.search))
		if w.Code != 200 || len(results(t, body)) != tc.count {
			t.Fatalf("Offer search %q: %d %s", tc.search, w.Code, w.Body.String())
		}
		for _, item := range results(t, body) {
			v := item.(map[string]any)
			if v["storeId"] != "market-sanaa" || len(v) != 6 || v["available"] != true {
				t.Fatalf("private/cross-Store Offer projection: %v", v)
			}
		}
	}
	path := "/v1/public/stores/market-sanaa/offers?limit=1&q=flour"
	w, first := request(s, path)
	cursor, ok := first["nextCursor"].(string)
	if w.Code != 200 || !ok || results(t, first)[0].(map[string]any)["id"] != "of-flour" {
		t.Fatalf("search first page: %s", w.Body.String())
	}
	w, second := request(s, path+"&cursor="+url.QueryEscape(cursor))
	if w.Code != 200 || len(results(t, second)) != 1 || results(t, second)[0].(map[string]any)["id"] != "of-water" {
		t.Fatalf("search continuation: %s", w.Body.String())
	}
	for _, changed := range []string{
		"/v1/public/stores/market-sanaa/offers", "/v1/public/stores/market-sanaa/offers?q=" + url.QueryEscape("دقيق"),
		"/v1/public/stores/direct-sanaa/offers?q=flour",
	} {
		separator := "?"
		if strings.Contains(changed, "?") {
			separator = "&"
		}
		w, _ = request(s, changed+separator+"cursor="+url.QueryEscape(cursor))
		if w.Code != 400 {
			t.Fatalf("changed Offer search/Store accepted cursor: %d %s", w.Code, w.Body.String())
		}
	}
	// The pre-search blank-query cursor format remains consumable.
	w, legacy := request(s, "/v1/public/stores/market-sanaa/offers?limit=1")
	old := legacy["nextCursor"].(string)
	w, blank := request(s, "/v1/public/stores/market-sanaa/offers?limit=1&q=+++&cursor="+url.QueryEscape(old))
	if w.Code != 200 || len(results(t, blank)) != 1 {
		t.Fatalf("legacy blank-search cursor failed: %s", w.Body.String())
	}
	for _, id := range []string{"draft-sanaa", "disabled-vertical-store"} {
		w, _ = request(s, "/v1/public/stores/"+id+"/offers?q=flour")
		if w.Code != 404 {
			t.Fatalf("hidden Store disclosed through search: %d %s", w.Code, w.Body.String())
		}
	}
	w, direct := request(s, "/v1/public/stores/direct-sanaa/offers?q=flour")
	if w.Code != 200 || len(results(t, direct)) != 0 {
		t.Fatalf("Offer search crossed Store: %s", w.Body.String())
	}
	for _, tc := range []struct{ deny, restore string }{
		{"UPDATE products SET active=false WHERE id='p-flour'", "UPDATE products SET active=true WHERE id='p-flour'"},
		{"UPDATE variants SET sellable=false WHERE id='v-p-flour'", "UPDATE variants SET sellable=true WHERE id='v-p-flour'"},
		{"UPDATE variants SET required_attributes_valid=false WHERE id='v-p-flour'", "UPDATE variants SET required_attributes_valid=true WHERE id='v-p-flour'"},
		{"UPDATE offers SET available=false WHERE id='of-flour'", "UPDATE offers SET available=true WHERE id='of-flour'"},
		{"UPDATE offers SET price_yer=0 WHERE id='of-flour'", "UPDATE offers SET price_yer=1200 WHERE id='of-flour'"},
	} {
		mutate(tc.deny)
		w, denied := request(s, "/v1/public/stores/market-sanaa/offers?q="+url.QueryEscape("دقيق"))
		if w.Code != 200 || len(results(t, denied)) != 0 {
			t.Fatalf("search bypassed Offer eligibility: %s", w.Body.String())
		}
		mutate(tc.restore)
	}
	mutate("UPDATE stores SET published=false WHERE id='market-sanaa'")
	w, _ = request(s, path+"&cursor="+url.QueryEscape(cursor))
	if w.Code != 404 {
		t.Fatalf("withdrawn Store continued searched page: %d %s", w.Code, w.Body.String())
	}
	if err := owner.ImportSynthetic(ctx); err != nil {
		t.Fatal(err)
	}
	w, _ = request(s, path+"&cursor="+url.QueryEscape(cursor))
	if w.Code != 409 {
		t.Fatalf("stale Offer search cursor accepted: %d %s", w.Code, w.Body.String())
	}
}
