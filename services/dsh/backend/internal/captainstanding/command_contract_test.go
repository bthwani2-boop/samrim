package captainstanding

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Exercise the actual owner handlers, including the final repository boundary.
// A rejected representation must never become a valid business command.
func TestCaptainCommandFraming(t *testing.T) {
	const standingPath = "/v1/operators/captains/captain-17/standing"
	const contactPath = "/v1/operators/captain-interest/42/contact"
	const standingJSON = `{"status":"APPROVED","expectedVersion":1,"operationId":"approval-001","reason":"verified"}`
	const contactJSON = `{"contacted":true}`
	type tc struct {
		name, method, path, body string
		media, encoding          []string
		want                     int
	}
	media := []string{"application/json"}
	cases := []tc{
		{"standing malformed surrogate", "PATCH", standingPath, strings.Replace(standingJSON, "verified", `verifi\ud800ed`, 1), media, nil, 400},
		{"standing invalid UTF8", "PATCH", standingPath, strings.Replace(standingJSON, "verified", "verifi"+string([]byte{0xff})+"ed", 1), media, nil, 400},
		{"standing duplicate media", "PATCH", standingPath, standingJSON, []string{"application/json", "text/plain"}, nil, 400},
		{"standing unknown charset", "PATCH", standingPath, standingJSON, []string{"application/json; charset=latin1"}, nil, 400},
		{"standing encoding", "PATCH", standingPath, standingJSON, media, []string{"gzip"}, 400},
		{"standing empty query", "PATCH", standingPath + "?", standingJSON, media, nil, 400},
		{"standing unknown member", "PATCH", standingPath, strings.Replace(standingJSON, `"reason"`, `"Reason"`, 1), media, nil, 400},
		{"standing duplicate member", "PATCH", standingPath, strings.Replace(standingJSON, `"reason":"verified"`, `"reason":"first","reason":"verified"`, 1), media, nil, 400},
		{"standing null", "PATCH", standingPath, strings.Replace(standingJSON, `"verified"`, "null", 1), media, nil, 400},
		{"standing good", "PATCH", standingPath, standingJSON, []string{"application/json; charset=UTF-8"}, nil, 200},
		{"intake null experience", "POST", CaptainInterestPath, strings.Replace(validInterestJSON, `"experienced":false`, `"experienced":null`, 1), media, nil, 400},
		{"intake null optional details", "POST", CaptainInterestPath, strings.Replace(validInterestJSON, `"experienced":false`, `"experienced":false,"experienceDetails":null`, 1), media, nil, 400},
		{"intake null optional plate", "POST", CaptainInterestPath, strings.Replace(strings.Replace(validInterestJSON, `"vehicleType":"MOTORCYCLE"`, `"vehicleType":"BICYCLE"`, 1), `"plateRegistered":true`, `"plateRegistered":null`, 1), media, nil, 400},
		{"intake malformed surrogate", "POST", CaptainInterestPath, strings.Replace(validInterestJSON, `محمد أحمد`, `Test\ud800 candidate`, 1), media, nil, 400},
		{"intake invalid UTF8", "POST", CaptainInterestPath, strings.Replace(validInterestJSON, `محمد أحمد`, "Test"+string([]byte{0xff})+" candidate", 1), media, nil, 400},
		{"intake missing experience", "POST", CaptainInterestPath, strings.Replace(validInterestJSON, `,"experienced":false`, "", 1), media, nil, 400},
		{"intake duplicate media", "POST", CaptainInterestPath, validInterestJSON, []string{"application/json", "text/plain"}, nil, 400},
		{"intake encoding", "POST", CaptainInterestPath, validInterestJSON, media, []string{"gzip"}, 400},
		{"intake empty query", "POST", CaptainInterestPath + "?", validInterestJSON, media, nil, 400},
		{"intake good", "POST", CaptainInterestPath, validInterestJSON, media, nil, 202},
		{"contact duplicate media", "PATCH", contactPath, contactJSON, []string{"application/json", "text/plain"}, nil, 400},
		{"contact encoding", "PATCH", contactPath, contactJSON, media, []string{"gzip"}, 400},
		{"contact empty query", "PATCH", contactPath + "?", contactJSON, media, nil, 400},
		{"contact null", "PATCH", contactPath, `{"contacted":null}`, media, nil, 400},
		{"contact good", "PATCH", contactPath, contactJSON, media, nil, 200},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			standing := &fakeStandingRepository{standing: Standing{ActorID: "captain-17", Status: Pending, Version: 1}}
			interest := &memoryInterestRepo{entries: []Interest{{ID: 42}}}
			var handler http.Handler
			if strings.HasPrefix(c.path, standingPath) {
				handler = NewHTTPHandler(NewService(&fakeIdentity{actor: Actor{ID: "operator-1", Role: "operator"}, allow: true}, standing))
			} else {
				handler = NewInterestHTTPHandler(NewInterestService(interestIdentity{allow: true}, interest))
			}
			req := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
			for _, v := range c.media {
				req.Header.Add("Content-Type", v)
			}
			for _, v := range c.encoding {
				req.Header.Add("Content-Encoding", v)
			}
			if strings.HasPrefix(c.path, standingPath) {
				req.Header.Set("Authorization", "Bearer operator-credential")
			}
			if strings.HasPrefix(c.path, contactPath) {
				req.Header.Set("Authorization", "Bearer operator-test-token")
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != c.want {
				t.Errorf("status=%d want=%d body=%s", w.Code, c.want, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Error("private or intake response cached")
			}
			effects := standing.changes + len(interest.inserts)
			if interest.entries[0].Contacted {
				effects++
			}
			wantEffects := 0
			if c.want < 300 {
				wantEffects = 1
			}
			if effects != wantEffects {
				t.Errorf("owner effects=%d want=%d", effects, wantEffects)
			}
		})
	}
}
