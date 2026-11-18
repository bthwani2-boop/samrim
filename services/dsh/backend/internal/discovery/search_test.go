package discovery

import (
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestStoreSearchValidationAndCursorScope(t *testing.T) {
	for _, q := range []string{"متجر", "%_", "' OR true --", strings.Repeat("😀", 76)} {
		r := httptest.NewRequest("GET", "/v1/public/stores?city_id=sanaa&q="+url.QueryEscape("  "+q+"  "), nil)
		got, scope, ok := storeSearch(r)
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
	_, scope, ok := storeSearch(httptest.NewRequest("GET", "/v1/public/stores?city_id=sanaa&q=+", nil))
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
