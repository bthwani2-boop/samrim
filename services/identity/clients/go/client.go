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

type ActorRoleView struct {
	ActorID      string `json:"actorId"`
	PhoneE164    string `json:"phoneE164"`
	Username     string `json:"username,omitempty"`
	Role         string `json:"role"`
	Enabled         bool   `json:"enabled"`
	SecurityEnabled bool   `json:"securityEnabled"`
	ActorVersion    int    `json:"actorVersion"`
	RoleVersion  int    `json:"roleVersion"`
	ActorCreated bool   `json:"actorCreated,omitempty"`
	RoleCreated  bool   `json:"roleCreated,omitempty"`
}

type ProvisionActorRoleRequest struct {
	PhoneE164 string `json:"phoneE164"`
	Role      string `json:"role"`
	Username  string `json:"username,omitempty"`
	Password  string `json:"password,omitempty"`
}

type PasswordResetRequest struct {
	Password string `json:"password"`
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
	token   string
	http    *http.Client
}

func New(baseURL, serviceToken string) (*Client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	serviceToken = strings.TrimSpace(serviceToken)
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, errors.New("identity client base URL is invalid")
	}
	if len(serviceToken) < 24 {
		return nil, errors.New("identity client service token is too short")
	}
	return &Client{
		baseURL: baseURL,
		token: serviceToken,
		http: &http.Client{Timeout: 8 * time.Second},
	}, nil
}

func (c *Client) ProvisionRole(ctx context.Context, input ProvisionActorRoleRequest) (ActorRoleView, error) {
	var result ActorRoleView
	err := c.do(ctx, http.MethodPost, "/internal/actor-roles/provision", "", input, &result)
	return result, err
}

func (c *Client) ReadRole(ctx context.Context, actorID, role string) (ActorRoleView, error) {
	var result ActorRoleView
	pathname := "/internal/actors/" + url.PathEscape(strings.TrimSpace(actorID)) + "/roles/" + url.PathEscape(strings.TrimSpace(role))
	err := c.do(ctx, http.MethodGet, pathname, "", nil, &result)
	return result, err
}

func (c *Client) SetRoleEnabled(ctx context.Context, actorID, role string, enabled bool, correlationID string) error {
	action := "disable"
	if enabled {
		action = "enable"
	}
	pathname := "/internal/actors/" + url.PathEscape(strings.TrimSpace(actorID)) + "/roles/" + url.PathEscape(strings.TrimSpace(role)) + "/" + action
	return c.do(ctx, http.MethodPost, pathname, correlationID, nil, nil)
}

func (c *Client) SetActorSecurityEnabled(ctx context.Context, actorID string, enabled bool, correlationID string) error {
	action := "disable"
	if enabled {
		action = "enable"
	}
	pathname := "/internal/actors/" + url.PathEscape(strings.TrimSpace(actorID)) + "/security/" + action
	return c.do(ctx, http.MethodPost, pathname, correlationID, nil, nil)
}

func (c *Client) ResetOperatorPassword(ctx context.Context, actorID, password, correlationID string) error {
	pathname := "/internal/actors/" + url.PathEscape(strings.TrimSpace(actorID)) + "/operator-password/reset"
	return c.do(ctx, http.MethodPost, pathname, correlationID, PasswordResetRequest{Password: password}, nil)
}

func (c *Client) do(ctx context.Context, method, pathname, correlationID string, body any, target any) error {
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
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
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
