package session

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCustomerPhoneHandlerRestrictsSyntheticSMTPDestination(t *testing.T) {
	cases := []struct {
		name          string
		address       string
		containerMode bool
		allowed       bool
	}{
		{"loopback", "127.0.0.1:1025", false, true},
		{"container mailpit", "mailpit:1025", true, true},
		{"mailpit outside container", "mailpit:1025", false, false},
		{"mailpit wrong port", "mailpit:25", true, false},
		{"external host", "smtp.example.test:25", true, false},
		{"external address", "192.0.2.1:25", false, false},
		{"nonliteral loopback", "localhost:1025", false, false},
		{"mailpit lookalike", "mailpit.example.test:1025", true, false},
		{"missing port", "127.0.0.1", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h, err := NewCustomerPhoneHandler(&PostgresReader{}, strings.Repeat("01", 32), tc.address, tc.containerMode, "+967770000003")
			if tc.allowed && (err != nil || h == nil) {
				t.Fatalf("isolated destination rejected: %v", err)
			}
			if !tc.allowed && (err == nil || h != nil) {
				t.Fatal("unsafe SMTP destination admitted")
			}
		})
	}
}

func TestCustomerPhoneHandlerRejectsInvalidAllowlist(t *testing.T) {
	for _, phones := range []string{"", "+12025559999", "+967770000003\r\nBcc: attacker@example.test"} {
		h, err := NewCustomerPhoneHandler(&PostgresReader{}, strings.Repeat("01", 32), "127.0.0.1:1025", false, phones)
		if err == nil || h != nil {
			t.Fatal("invalid synthetic allowlist admitted")
		}
	}
}

func TestCustomerPhoneHandlerRejectsUnapprovedPhoneBeforeStorage(t *testing.T) {
	// The reader deliberately has no database. Reaching storage would fail
	// instead of returning the expected pre-storage input rejection.
	h, err := NewCustomerPhoneHandler(&PostgresReader{}, strings.Repeat("01", 32), "127.0.0.1:1", false, "+967770000003")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, PhoneChallengePath, strings.NewReader("{\"phone\":\"+967770000004\"}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "INVALID_REQUEST") ||
		!strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("unapproved phone was not rejected safely: status=%d", w.Code)
	}
}

func TestDeliverPhoneCodeRejectsUnsafePayloadBeforeDial(t *testing.T) {
	cases := []struct {
		name  string
		phone string
		code  string
	}{
		{"header injection in phone", "+967770000032\r\nBcc: attacker@example.test", "123456"},
		{"header injection in code", "+967770000032", "123456\r\nBcc: attacker@example.test"},
		{"unexpected phone", "+12025559999", "123456"},
		{"unexpected code", "+967770000032", "12345"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			err := deliverPhoneCode(ctx, "127.0.0.1:1", tc.phone, tc.code)
			if err == nil || !strings.Contains(err.Error(), "invalid synthetic phone verification payload") {
				t.Fatalf("unsafe synthetic payload reached SMTP transport: %v", err)
			}
		})
	}
}

func TestDeliverPhoneCodePreservesCanonicalSyntheticEmail(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	type result struct {
		body string
		err  error
	}
	finished := make(chan result, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			finished <- result{err: acceptErr}
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		send := func(reply string) error {
			_, writeErr := fmt.Fprint(conn, reply)
			return writeErr
		}
		if greetErr := send("220 synthetic-smtp ESMTP\r\n"); greetErr != nil {
			finished <- result{err: greetErr}
			return
		}
		var senderSeen, recipientSeen bool
		for {
			line, readErr := reader.ReadString('\n')
			if readErr != nil {
				finished <- result{err: readErr}
				return
			}
			switch {
			case strings.HasPrefix(line, "EHLO "), strings.HasPrefix(line, "HELO "):
				readErr = send("250 synthetic-smtp\r\n")
			case line == "MAIL FROM:<identity@identity.test>\r\n" && !senderSeen:
				senderSeen = true
				readErr = send("250 accepted\r\n")
			case line == "RCPT TO:<verification@identity.test>\r\n" && senderSeen && !recipientSeen:
				recipientSeen = true
				readErr = send("250 accepted\r\n")
			case line == "DATA\r\n" && senderSeen && recipientSeen:
				if readErr = send("354 continue\r\n"); readErr != nil {
					finished <- result{err: readErr}
					return
				}
				var email strings.Builder
				for {
					part, partErr := reader.ReadString('\n')
					if partErr != nil {
						finished <- result{err: partErr}
						return
					}
					if part == ".\r\n" {
						break
					}
					email.WriteString(part)
				}
				finished <- result{body: email.String(), err: send("250 accepted\r\n")}
				return
			default:
				readErr = errors.New("unexpected SMTP command")
			}
			if readErr != nil {
				finished <- result{err: readErr}
				return
			}
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := deliverPhoneCode(ctx, listener.Addr().String(), "+967770000003", "000123"); err != nil {
		t.Fatal(err)
	}
	select {
	case captured := <-finished:
		if captured.err != nil {
			t.Fatal(captured.err)
		}
		if !strings.Contains(captured.body, "From: identity@identity.test\r\nTo: verification@identity.test\r\n") ||
			!strings.Contains(captured.body, "\r\nPhone: +967770000003\r\nCode: 000123\r\n") {
			t.Fatalf("synthetic message was altered: %q", captured.body)
		}
	case <-ctx.Done():
		t.Fatal("synthetic SMTP transport did not finish")
	}
}

func TestDeliverPhoneCodeCancelsConnectedTransport(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	accepted := make(chan net.Conn, 1)
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			accepted <- conn
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- deliverPhoneCode(ctx, listener.Addr().String(), "+967770000003", "000123")
	}()
	var conn net.Conn
	select {
	case conn = <-accepted:
	case <-time.After(2 * time.Second):
		t.Fatal("transport did not connect")
	}
	defer conn.Close()
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled transport reported success")
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("connected SMTP transport ignored request cancellation")
	}
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := conn.Read(make([]byte, 1)); !errors.Is(err, io.EOF) {
		t.Fatalf("cancelled socket was not closed: %v", err)
	}
}
