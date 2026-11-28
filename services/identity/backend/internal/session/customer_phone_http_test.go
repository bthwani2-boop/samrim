package session

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Only disposable test keys are created. No runtime trust material is reused.
func phoneTestTrust(t testing.TB, host string) ([]byte, tls.Certificate) {
	t.Helper()
	rootKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	root := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "disposable SMTP CA"},
		NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}
	rootDER, err := x509.CreateCertificate(rand.Reader, root, root, &rootKey.PublicKey, rootKey)
	if err != nil {
		t.Fatal(err)
	}
	leaf := &x509.Certificate{
		SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: host},
		NotBefore: root.NotBefore, NotAfter: root.NotAfter,
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	if ip := net.ParseIP(host); ip != nil {
		leaf.IPAddresses = []net.IP{ip}
	} else {
		leaf.DNSNames = []string{host}
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, root, &leafKey.PublicKey, rootKey)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: rootDER}), tls.Certificate{
		Certificate: [][]byte{leafDER, rootDER}, PrivateKey: leafKey,
	}
}

func TestCustomerPhoneHandlerRestrictsSyntheticSMTPDestination(t *testing.T) {
	ca, _ := phoneTestTrust(t, "127.0.0.1")
	cases := []struct {
		name, address          string
		containerMode, allowed bool
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
		{"invalid port", "127.0.0.1:smtp", false, false},
		{"zero port", "127.0.0.1:0", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h, err := NewCustomerPhoneHandler(&PostgresReader{}, strings.Repeat("01", 32), tc.address, tc.containerMode, "+967770000003", ca)
			if tc.allowed != (err == nil && h != nil) {
				t.Fatalf("destination admission mismatch: %v", err)
			}
		})
	}
}

func TestCustomerPhoneHandlerRequiresDedicatedCATrust(t *testing.T) {
	ca, leaf := phoneTestTrust(t, "127.0.0.1")
	for _, tc := range []struct {
		name   string
		bundle []byte
	}{
		{"missing", nil},
		{"garbage", []byte("not a certificate")},
		{"mixed", append(bytes.Clone(ca), []byte("invalid trailing content")...)},
		{"leaf only", pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leaf.Certificate[0]})},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, err := NewCustomerPhoneHandler(&PostgresReader{}, strings.Repeat("01", 32), "127.0.0.1:1025", false, "+967770000003", tc.bundle)
			if err == nil || h != nil {
				t.Fatal("invalid trust material admitted")
			}
		})
	}
}

func TestCustomerPhoneHandlerRejectsInvalidAllowlist(t *testing.T) {
	ca, _ := phoneTestTrust(t, "127.0.0.1")
	for _, phones := range []string{"", "+12025559999", "+967770000003\r\nBcc: attacker@example.test"} {
		h, err := NewCustomerPhoneHandler(&PostgresReader{}, strings.Repeat("01", 32), "127.0.0.1:1025", false, phones, ca)
		if err == nil || h != nil {
			t.Fatal("invalid synthetic allowlist admitted")
		}
	}
}

func TestCustomerPhoneHandlerRejectsUnapprovedPhoneBeforeStorage(t *testing.T) {
	ca, _ := phoneTestTrust(t, "127.0.0.1")
	h, err := NewCustomerPhoneHandler(&PostgresReader{}, strings.Repeat("01", 32), "127.0.0.1:1", false, "+967770000003", ca)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, PhoneChallengePath, strings.NewReader(`{"phone":"+967770000004"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "INVALID_REQUEST") ||
		w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unapproved phone was not rejected safely: status=%d", w.Code)
	}
}

func phoneDeliveryFixture(t *testing.T, address string, ca []byte) *phoneSMTP {
	t.Helper()
	s, err := newPhoneSMTP(address, false, ca)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestDeliverPhoneCodeRejectsUnsafePayloadBeforeDial(t *testing.T) {
	ca, _ := phoneTestTrust(t, "127.0.0.1")
	s := phoneDeliveryFixture(t, "127.0.0.1:1", ca)
	for _, tc := range []struct{ phone, code string }{
		{"+967770000032\r\nBcc: attacker@example.test", "123456"},
		{"+967770000032", "123456\r\nBcc: attacker@example.test"},
		{"+12025559999", "123456"},
		{"+967770000032", "12345"},
	} {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		err := s.deliver(ctx, tc.phone, tc.code)
		cancel()
		if err == nil || !strings.Contains(err.Error(), "invalid synthetic phone verification payload") {
			t.Fatalf("unsafe payload reached SMTP transport: %v", err)
		}
	}
}

type phoneSMTPResult struct {
	body string
	err  error
}

func phoneSMTPListener(t *testing.T) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	return listener
}

// The fixture implements the actual SMTP command boundary, with a real TLS
// server and actual wire bytes. It accepts DATA only after MAIL and RCPT.
func capturePhoneSMTP(listener net.Listener, cert tls.Certificate) <-chan phoneSMTPResult {
	finished := make(chan phoneSMTPResult, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			finished <- phoneSMTPResult{err: err}
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		secured := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12})
		if err := secured.Handshake(); err != nil {
			finished <- phoneSMTPResult{err: err}
			return
		}
		body, err := readPhoneSMTP(secured)
		finished <- phoneSMTPResult{body: body, err: err}
	}()
	return finished
}

func readPhoneSMTP(conn net.Conn) (string, error) {
	reader := bufio.NewReader(conn)
	send := func(reply string) error {
		_, err := fmt.Fprint(conn, reply)
		return err
	}
	if err := send("220 synthetic-smtp ESMTP\r\n"); err != nil {
		return "", err
	}
	var senderSeen, recipientSeen bool
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return "", err
		}
		switch {
		case strings.HasPrefix(line, "EHLO "), strings.HasPrefix(line, "HELO "):
			err = send("250 synthetic-smtp\r\n")
		case line == "MAIL FROM:<identity@identity.test>\r\n" && !senderSeen:
			senderSeen = true
			err = send("250 accepted\r\n")
		case line == "RCPT TO:<verification@identity.test>\r\n" && senderSeen && !recipientSeen:
			recipientSeen = true
			err = send("250 accepted\r\n")
		case line == "DATA\r\n" && senderSeen && recipientSeen:
			if err = send("354 continue\r\n"); err != nil {
				return "", err
			}
			var email strings.Builder
			for {
				part, err := reader.ReadString('\n')
				if err != nil {
					return "", err
				}
				if part == ".\r\n" {
					return email.String(), send("250 accepted\r\n")
				}
				email.WriteString(part)
			}
		default:
			return "", errors.New("unexpected SMTP command")
		}
		if err != nil {
			return "", err
		}
	}
}

func TestDeliverPhoneCodePreservesCanonicalSyntheticEmail(t *testing.T) {
	ca, cert := phoneTestTrust(t, "127.0.0.1")
	listener := phoneSMTPListener(t)
	finished := capturePhoneSMTP(listener, cert)
	s := phoneDeliveryFixture(t, listener.Addr().String(), ca)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := s.deliver(ctx, "+967770000003", "000123"); err != nil {
		t.Fatal(err)
	}
	select {
	case captured := <-finished:
		if captured.err != nil {
			t.Fatal(captured.err)
		}
		if !strings.Contains(captured.body, "From: identity@identity.test\r\nTo: verification@identity.test\r\n") ||
			!strings.Contains(captured.body, "\r\nPhone: +967770000003\r\nCode: 000123\r\n") {
			t.Fatal("canonical synthetic message was altered")
		}
	case <-ctx.Done():
		t.Fatal("synthetic SMTP transport did not finish")
	}
}

func TestDeliverPhoneCodeRejectsPlaintextSMTP(t *testing.T) {
	ca, _ := phoneTestTrust(t, "127.0.0.1")
	listener := phoneSMTPListener(t)
	finished := make(chan phoneSMTPResult, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			finished <- phoneSMTPResult{err: err}
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		_, _ = fmt.Fprint(conn, "220 plaintext ESMTP\r\n")
		raw, err := io.ReadAll(conn)
		finished <- phoneSMTPResult{body: string(raw), err: err}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := phoneDeliveryFixture(t, listener.Addr().String(), ca).deliver(ctx, "+967770000003", "000123"); err == nil {
		t.Fatal("plaintext SMTP delivery unexpectedly succeeded")
	}
	select {
	case captured := <-finished:
		if strings.Contains(captured.body, "MAIL FROM:") || strings.Contains(captured.body, "Phone:") || strings.Contains(captured.body, "Code:") {
			t.Fatal("SMTP payload crossed the unauthenticated connection")
		}
	case <-ctx.Done():
		t.Fatal("plaintext rejection did not close the transport")
	}
}

func TestDeliverPhoneCodeRejectsUntrustedPeers(t *testing.T) {
	for _, tc := range []struct {
		name, host string
		wrongRoot  bool
	}{
		{"wrong peer name", "mailpit", false},
		{"unknown root", "127.0.0.1", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ca, cert := phoneTestTrust(t, tc.host)
			if tc.wrongRoot {
				ca, _ = phoneTestTrust(t, "127.0.0.1")
			}
			listener := phoneSMTPListener(t)
			finished := capturePhoneSMTP(listener, cert)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if err := phoneDeliveryFixture(t, listener.Addr().String(), ca).deliver(ctx, "+967770000003", "000123"); err == nil {
				t.Fatal("untrusted SMTP peer accepted")
			}
			select {
			case captured := <-finished:
				if captured.err == nil || captured.body != "" {
					t.Fatal("untrusted peer reached SMTP data")
				}
			case <-ctx.Done():
				t.Fatal("rejected peer did not close")
			}
		})
	}
}

func TestDeliverPhoneCodeCancelsConnectedTransport(t *testing.T) {
	ca, cert := phoneTestTrust(t, "127.0.0.1")
	for _, handshake := range []bool{false, true} {
		t.Run(fmt.Sprintf("handshake=%t", handshake), func(t *testing.T) {
			listener := phoneSMTPListener(t)
			ready := make(chan net.Conn, 1)
			serverErr := make(chan error, 1)
			go func() {
				conn, err := listener.Accept()
				if err != nil {
					serverErr <- err
					return
				}
				if handshake {
					secured := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12})
					_ = secured.SetDeadline(time.Now().Add(3 * time.Second))
					if err := secured.Handshake(); err != nil {
						_ = conn.Close()
						serverErr <- err
						return
					}
					conn = secured
				}
				ready <- conn
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			s := phoneDeliveryFixture(t, listener.Addr().String(), ca)
			done := make(chan error, 1)
			go func() { done <- s.deliver(ctx, "+967770000003", "000123") }()
			var conn net.Conn
			select {
			case conn = <-ready:
			case err := <-serverErr:
				t.Fatal(err)
			case <-time.After(3 * time.Second):
				t.Fatal("transport did not connect")
			}
			defer conn.Close()
			cancel()
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("cancelled transport reported success")
				}
			case <-time.After(time.Second):
				t.Fatal("connected transport ignored cancellation")
			}
			_ = conn.SetReadDeadline(time.Now().Add(time.Second))
			_, err := io.ReadAll(conn)
			var timeout net.Error
			if errors.As(err, &timeout) && timeout.Timeout() {
				t.Fatal("cancelled socket remained open")
			}
		})
	}
}
