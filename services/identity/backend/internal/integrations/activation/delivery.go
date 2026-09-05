package activationdelivery

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/smtp"
	"net/url"
	"strings"
	"time"
)

type Message struct {
	Phone     string
	Code      string
	Role      string
	Surface   string
	ExpiresAt time.Time
}

type Sender interface {
	Send(context.Context, Message) error
}

type Mailpit struct {
	SMTPAddr  string
	Recipient string
}

func (m Mailpit) Send(_ context.Context, message Message) error {
	if strings.TrimSpace(m.SMTPAddr) == "" || strings.TrimSpace(m.Recipient) == "" {
		return errors.New("mailpit delivery is not configured")
	}
	body := "From: identity@samrim.local\r\n" +
		"To: " + m.Recipient + "\r\n" +
		"Subject: Samrim activation code\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
		"Phone: " + message.Phone + "\r\n" +
		"Surface: " + message.Surface + "\r\n" +
		"Code: " + message.Code + "\r\n" +
		"Expires: " + message.ExpiresAt.UTC().Format(time.RFC3339) + "\r\n"
	return smtp.SendMail(m.SMTPAddr, nil, "identity@samrim.local", []string{m.Recipient}, []byte(body))
}

type Twilio struct {
	AccountSID string
	AuthToken  string
	From       string
	Client     *http.Client
}

func (t Twilio) Send(ctx context.Context, message Message) error {
	if t.Client == nil {
		t.Client = &http.Client{Timeout: 10 * time.Second}
	}
	if strings.TrimSpace(t.AccountSID) == "" || strings.TrimSpace(t.AuthToken) == "" || strings.TrimSpace(t.From) == "" {
		return errors.New("twilio delivery is not configured")
	}
	form := url.Values{}
	form.Set("To", message.Phone)
	form.Set("From", t.From)
	form.Set("Body", fmt.Sprintf("Your BThwani activation code is %s. It expires at %s.", message.Code, message.ExpiresAt.UTC().Format(time.RFC3339)))
	endpoint := "https://api.twilio.com/2010-04-01/Accounts/" + url.PathEscape(t.AccountSID) + "/Messages.json"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.SetBasicAuth(t.AccountSID, t.AuthToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := t.Client.Do(req)
	if err != nil {
		return err
	}
	defer func(){ _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("twilio activation delivery failed: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	return nil
}

type Webhook struct {
	URL    string
	Token  string
	Client *http.Client
}

func (w Webhook) Send(ctx context.Context, message Message) error {
	if w.Client == nil {
		w.Client = &http.Client{Timeout: 10 * time.Second}
	}
	if strings.TrimSpace(w.URL) == "" || strings.TrimSpace(w.Token) == "" {
		return errors.New("webhook delivery is not configured")
	}
	payload := map[string]any{
		"phone":message.Phone,
		"code":message.Code,
		"role":message.Role,
		"surface":message.Surface,
		"expiresAt":message.ExpiresAt.UTC().Format(time.RFC3339),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+w.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := w.Client.Do(req)
	if err != nil {
		return err
	}
	defer func(){ _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("activation webhook failed: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	return nil
}
