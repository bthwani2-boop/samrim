package session

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"
)

func TestDeliverPhoneCodeRejectsUnsafePayloadBeforeDial(t *testing.T) {
	cases := []struct {
		name  string
		phone string
		code  string
	}{
		{"header injection in phone", "+12025550132\r\nBcc: attacker@example.test", "123456"},
		{"header injection in code", "+12025550132", "123456\r\nBcc: attacker@example.test"},
		{"unexpected phone", "+12025559999", "123456"},
		{"unexpected code", "+12025550132", "12345"},
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
		for {
			line, readErr := reader.ReadString('\n')
			if readErr != nil {
				finished <- result{err: readErr}
				return
			}
			switch {
			case strings.HasPrefix(line, "EHLO "), strings.HasPrefix(line, "HELO "):
				readErr = send("250 synthetic-smtp\r\n")
			case strings.HasPrefix(line, "MAIL FROM:"), strings.HasPrefix(line, "RCPT TO:"):
				readErr = send("250 accepted\r\n")
			case strings.HasPrefix(line, "DATA"):
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
	if err := deliverPhoneCode(ctx, listener.Addr().String(), "+12025550103", "000123"); err != nil {
		t.Fatal(err)
	}
	select {
	case captured := <-finished:
		if captured.err != nil {
			t.Fatal(captured.err)
		}
		if !strings.Contains(captured.body, "From: identity@identity.test\r\nTo: verification@identity.test\r\n") ||
			!strings.Contains(captured.body, "\r\nPhone: +12025550103\r\nCode: 000123\r\n") {
			t.Fatalf("synthetic message was altered: %q", captured.body)
		}
	case <-ctx.Done():
		t.Fatal("synthetic SMTP transport did not finish")
	}
}
