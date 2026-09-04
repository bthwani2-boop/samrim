package identityclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type ActorView struct {
	ActorID           string   `json:"actorId"`
	Username          string   `json:"username"`
	PhoneE164         string   `json:"phoneE164"`
	OperatorContextID string   `json:"operatorContextId"`
	Roles             []string `json:"roles"`
	Status            string   `json:"status"`
	Version           int      `json:"version"`
	Created           bool     `json:"created,omitempty"`
}

type ProvisionActorRequest struct {
	ActorID   string `json:"actorId,omitempty"`
	Username  string `json:"username"`
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
	Password  string `json:"password,omitempty"`
}

type IssueActivationRequest struct {
	ExpectedActorType string `json:"expectedActorType"`
}

type ActivationChallenge struct {
	ActivationID string    `json:"activationId"`
	MaskedPhone  string    `json:"maskedPhone"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("identity request failed: status=%d code=%s message=%s", e.Status, e.Code, e.Message)
}

type Client struct {
	baseURL string
	caller  string
	token   string
	http    *http.Client
}

func New(baseURL, caller, serviceToken string) (*Client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	caller = strings.ToLower(strings.TrimSpace(caller))
	serviceToken = strings.TrimSpace(serviceToken)
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, errors.New("identity client base URL is invalid")
	}
	switch caller {
	case "dsh", "platform-control":
	default:
		return nil, errors.New("identity client caller is invalid")
	}
	if len(serviceToken) < 24 {
		return nil, errors.New("identity client service token is too short")
	}
	return &Client{
		baseURL: baseURL,
		caller: caller,
		token: serviceToken,
		http: &http.Client{Timeout: 8 * time.Second},
	}, nil
}

func (c *Client) ProvisionActor(ctx context.Context, operatorContextID string, input ProvisionActorRequest) (ActorView, error) {
	var result ActorView
	err := c.do(ctx, http.MethodPost, "/internal/actors/provision", operatorContextID, "", "", input, &result)
	return result, err
}

func (c *Client) ReadActor(ctx context.Context, operatorContextID, actorID string) (ActorView, error) {
	var result ActorView
	err := c.do(ctx, http.MethodGet, "/internal/actors/"+url.PathEscape(strings.TrimSpace(actorID)), operatorContextID, "", "", nil, &result)
	return result, err
}

func (c *Client) IssueActivation(
	ctx context.Context,
	operatorContextID, actorID, actorType, idempotencyKey, correlationID string,
) (ActivationChallenge, error) {
	var result ActivationChallenge
	err := c.do(
		ctx,
		http.MethodPost,
		"/internal/actors/"+url.PathEscape(strings.TrimSpace(actorID))+"/activations",
		operatorContextID,
		idempotencyKey,
		correlationID,
		IssueActivationRequest{ExpectedActorType: actorType},
		&result,
	)
	return result, err
}

func (c *Client) do(
	ctx context.Context,
	method, pathname, operatorContextID, idempotencyKey, correlationID string,
	body any,
	target any,
) error {
	operatorContextID = strings.TrimSpace(operatorContextID)
	if operatorContextID == "" || len(operatorContextID) > 128 {
		return errors.New("identity operator context is required")
	}

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+pathname, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Service-Caller", c.caller)
	req.Header.Set("X-Operator-Context-ID", operatorContextID)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(idempotencyKey) != "" {
		req.Header.Set("Idempotency-Key", strings.TrimSpace(idempotencyKey))
	}
	if strings.TrimSpace(correlationID) != "" {
		req.Header.Set("X-Correlation-ID", strings.TrimSpace(correlationID))
	}

	response, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&payload)
		return &Error{
			Status: response.StatusCode,
			Code: strings.TrimSpace(payload.Error.Code),
			Message: strings.TrimSpace(payload.Error.Message),
		}
	}
	if target == nil || response.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(io.LimitReader(response.Body, 256*1024)).Decode(target)
}
