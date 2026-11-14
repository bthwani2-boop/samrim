package session

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type readerFunc func(context.Context, [32]byte) (Principal, error)

func (f readerFunc) Lookup(ctx context.Context, digest [32]byte) (Principal, error) {
	return f(ctx, digest)
}

func testToken(fill byte) (string, [32]byte) {
	raw := bytes.Repeat([]byte{fill}, 32)
	return base64.RawURLEncoding.EncodeToString(raw), sha256.Sum256(raw)
}

func TestVerifierRejectsUnsafeBearerBeforeOwnerRead(t *testing.T) {
	calls := 0
	v := NewVerifier(readerFunc(func(context.Context, [32]byte) (Principal, error) {
		calls++
		return Principal{ActorID: "impossible"}, nil
	}))
	valid, _ := testToken(42)
	for _, header := range []string{"", "Bearer", "Bearer ", "bearer " + valid, "Basic " + valid, "Bearer " + valid + " ", "Bearer " + valid + "\n", "Bearer " + strings.Repeat("A", 42) + "!", "Bearer " + strings.Repeat("x", 1024)} {
		_, err := v.Verify(context.Background(), header)
		if !errors.Is(err, ErrUnauthorized) {
			t.Errorf("header %q: expected unauthorized, got %v", header, err)
		}
	}
	if calls != 0 {
		t.Fatalf("untrusted input reached owner %d times", calls)
	}
}
func TestVerifierUsesCryptographicDigestNotActorHeader(t *testing.T) {
	token, digest := testToken(4)
	expected := Principal{ActorID: "actor-1", Role: "merchant", ExpiresAt: time.Now().UTC().Add(time.Hour)}
	v := NewVerifier(readerFunc(func(_ context.Context, actual [32]byte) (Principal, error) {
		if actual != digest {
			t.Fatal("incorrect bearer digest")
		}
		return expected, nil
	}))
	got, err := v.Verify(context.Background(), "Bearer "+token)
	if err != nil || got.ActorID != expected.ActorID || got.Role != expected.Role {
		t.Fatalf("unexpected Identity read: %#v %v", got, err)
	}
}
func TestVerifierNoCrossActorCache(t *testing.T) {
	first, a := testToken(11)
	second, b := testToken(12)
	v := NewVerifier(readerFunc(func(_ context.Context, d [32]byte) (Principal, error) {
		if d == a {
			return Principal{ActorID: "actor-a", Role: "customer"}, nil
		}
		if d == b {
			return Principal{ActorID: "actor-b", Role: "merchant"}, nil
		}
		return Principal{}, ErrUnauthorized
	}))
	one, e1 := v.Verify(context.Background(), "Bearer "+first)
	two, e2 := v.Verify(context.Background(), "Bearer "+second)
	three, e3 := v.Verify(context.Background(), "Bearer "+first)
	if e1 != nil || e2 != nil || e3 != nil || one.ActorID != "actor-a" || two.ActorID != "actor-b" || three.ActorID != "actor-a" {
		t.Fatalf("actor leakage: %#v %#v %#v", one, two, three)
	}
}
func TestCurrentSessionHTTPFailClosed(t *testing.T) {
	token, _ := testToken(8)
	cases := []struct {
		name, method, path, authorization string
		readErr                           error
		status                            int
	}{
		{"good", "GET", "/v1/sessions/current", "Bearer " + token, nil, 200},
		{"no token", "GET", "/v1/sessions/current", "", nil, 401},
		{"invalid", "GET", "/v1/sessions/current", "Bearer nope", nil, 401},
		{"revoked", "GET", "/v1/sessions/current", "Bearer " + token, ErrUnauthorized, 401},
		{"database unavailable", "GET", "/v1/sessions/current", "Bearer " + token, errors.New("connection failed"), 503},
		{"forbidden method", "POST", "/v1/sessions/current", "Bearer " + token, nil, 405},
		{"not found", "GET", "/v1/roles", "Bearer " + token, nil, 404},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			v := NewVerifier(readerFunc(func(context.Context, [32]byte) (Principal, error) {
				if tt.readErr != nil {
					return Principal{}, tt.readErr
				}
				return Principal{ActorID: "synthetic-a", Role: "customer", ExpiresAt: time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC)}, nil
			}))
			request := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.authorization != "" {
				request.Header.Set("Authorization", tt.authorization)
			}
			recorder := httptest.NewRecorder()
			NewHandler(v).ServeHTTP(recorder, request)
			if recorder.Code != tt.status {
				t.Fatalf("status=%d expected=%d body=%s", recorder.Code, tt.status, recorder.Body.String())
			}
			if recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("session response may be cached")
			}
			if strings.Contains(recorder.Body.String(), token) || strings.Contains(recorder.Body.String(), "tokenDigest") {
				t.Fatal("bearer secret leaked")
			}
			if tt.status == 200 {
				var got Principal
				if e := json.Unmarshal(recorder.Body.Bytes(), &got); e != nil || got.ActorID != "synthetic-a" || got.Role != "customer" {
					t.Fatalf("invalid response %v %#v", e, got)
				}
			}
			if recorder.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("internal token check must not permit browser CORS")
			}
		})
	}
}
