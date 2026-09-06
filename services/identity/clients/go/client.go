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
	return &Client{baseURL: baseURL, token: serviceToken, http: &http.Client{Timeout: 8 * time.Second}}, nil
}

func (c *Client) IssueOperatorEnrollmentToken(ctx context.Context, input OperatorEnrollmentTokenIssueRequest) (OperatorEnrollmentToken, error) {
	var result OperatorEnrollmentToken
	err := c.do(ctx, IdentityOperationIssueOperatorEnrollmentToken.Method, IdentityOperationIssueOperatorEnrollmentToken.Path, "", input, &result)
	return result, err
}

func (c *Client) ProvisionRole(ctx context.Context, input ProvisionActorRoleRequest) (ActorRoleView, error) {
	var result ActorRoleView
	err := c.do(ctx, IdentityOperationProvisionActorRole.Method, IdentityOperationProvisionActorRole.Path, "", input, &result)
	return result, err
}
func (c *Client) ReadRole(ctx context.Context, actorID, role string) (ActorRoleView, error) {
	var result ActorRoleView
	pathname := identityRoute(IdentityOperationReadActorRole.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)), "role", url.PathEscape(strings.TrimSpace(role)))
	err := c.do(ctx, IdentityOperationReadActorRole.Method, pathname, "", nil, &result)
	return result, err
}
func (c *Client) SearchRoles(ctx context.Context, role, query string) (ActorRoleSearchPage, error) {
	params := url.Values{}
	params.Set("role", strings.TrimSpace(role))
	params.Set("q", strings.TrimSpace(query))
	params.Set("enabled", "true")
	params.Set("limit", "2")
	var result ActorRoleSearchPage
	err := c.do(ctx, IdentityOperationSearchActorRoles.Method, IdentityOperationSearchActorRoles.Path+"?"+params.Encode(), "", nil, &result)
	return result, err
}
func (c *Client) SearchRolesAnyState(ctx context.Context, role, query string) (ActorRoleSearchPage, error) {
	params := url.Values{}
	params.Set("role", strings.TrimSpace(role))
	params.Set("q", strings.TrimSpace(query))
	params.Set("limit", "2")
	var result ActorRoleSearchPage
	err := c.do(ctx, IdentityOperationSearchActorRoles.Method, IdentityOperationSearchActorRoles.Path+"?"+params.Encode(), "", nil, &result)
	return result, err
}
func (c *Client) LookupRoleByPhone(ctx context.Context, role, phone string) (ActorRoleView, error) {
	page, err := c.SearchRolesAnyState(ctx, role, phone)
	if err != nil {
		return ActorRoleView{}, err
	}
	if len(page.Items) == 0 {
		return ActorRoleView{}, &Error{Status: http.StatusNotFound, Code: "NOT_FOUND", Message: "managed role record not found"}
	}
	if len(page.Items) != 1 {
		return ActorRoleView{}, &Error{Status: http.StatusConflict, Code: "CONFLICT", Message: "managed role lookup is ambiguous"}
	}
	return page.Items[0], nil
}
func (c *Client) SetRoleEnabled(ctx context.Context, actorID, role string, enabled bool, correlationID string) error {
	return c.SetRoleEnabledWithReason(ctx, actorID, role, enabled, correlationID, "")
}
func (c *Client) SetRoleEnabledWithReason(ctx context.Context, actorID, role string, enabled bool, correlationID, reason string) error {
	operation := IdentityOperationDisableActorRole
	if enabled {
		operation = IdentityOperationEnableActorRole
	}
	pathname := identityRoute(operation.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)), "role", url.PathEscape(strings.TrimSpace(role)))
	return c.doWithReason(ctx, operation.Method, pathname, correlationID, reason, nil, nil)
}
func (c *Client) SetRoleEnabledWithContext(ctx context.Context, actorID, role string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	operation := IdentityOperationDisableActorRole
	if enabled {
		operation = IdentityOperationEnableActorRole
	}
	pathname := identityRoute(operation.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)), "role", url.PathEscape(strings.TrimSpace(role)))
	return c.doWithContext(ctx, operation.Method, pathname, correlationID, reason, operatorActorID, expectedVersion, nil, nil)
}
func (c *Client) AuthorizeReenrollment(ctx context.Context, actorID, role, correlationID string) error {
	pathname := identityRoute(IdentityOperationAuthorizeManagedRoleReenrollment.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)), "role", url.PathEscape(strings.TrimSpace(role)))
	return c.do(ctx, IdentityOperationAuthorizeManagedRoleReenrollment.Method, pathname, correlationID, nil, nil)
}
func (c *Client) AuthorizeReenrollmentByPhone(ctx context.Context, phone, role, correlationID string) error {
	page, err := c.SearchRoles(ctx, role, phone)
	if err != nil {
		return err
	}
	if len(page.Items) != 1 || !strings.EqualFold(strings.TrimSpace(page.Items[0].Role), strings.TrimSpace(role)) {
		return &Error{Status: http.StatusNotFound, Code: "NOT_FOUND", Message: "managed role record not found"}
	}
	return c.AuthorizeReenrollment(ctx, page.Items[0].ActorID, role, correlationID)
}
func (c *Client) SetActorSecurityEnabled(ctx context.Context, actorID string, enabled bool, correlationID string) error {
	return c.SetActorSecurityEnabledWithReason(ctx, actorID, enabled, correlationID, "")
}
func (c *Client) SetActorSecurityEnabledWithReason(ctx context.Context, actorID string, enabled bool, correlationID, reason string) error {
	return c.SetActorSecurityEnabledWithContext(ctx, actorID, enabled, correlationID, reason, "", 0)
}
func (c *Client) SetActorSecurityEnabledWithContext(ctx context.Context, actorID string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	operation := IdentityOperationDisableActorSecurity
	if enabled {
		operation = IdentityOperationEnableActorSecurity
	}
	pathname := identityRoute(operation.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)))
	return c.doWithContext(ctx, operation.Method, pathname, correlationID, reason, operatorActorID, expectedVersion, nil, nil)
}
func (c *Client) ResetOperatorPassword(ctx context.Context, actorID, password, correlationID string) error {
	pathname := identityRoute(IdentityOperationResetOperatorPassword.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)))
	return c.do(ctx, IdentityOperationResetOperatorPassword.Method, pathname, correlationID, PasswordResetRequest{Password: password}, nil)
}
func (c *Client) Readiness(ctx context.Context) error {
	return c.do(ctx, IdentityOperationIdentityReadiness.Method, IdentityOperationIdentityReadiness.Path, "", nil, nil)
}

func identityRoute(template string, replacements ...string) string {
	for index := 0; index+1 < len(replacements); index += 2 {
		template = strings.ReplaceAll(template, "{"+replacements[index]+"}", replacements[index+1])
	}
	return template
}

func (c *Client) do(ctx context.Context, method, pathname, correlationID string, body any, target any) error {
	return c.doWithContext(ctx, method, pathname, correlationID, "", "", 0, body, target)
}
func (c *Client) doWithReason(ctx context.Context, method, pathname, correlationID, reason string, body any, target any) error {
	return c.doWithContext(ctx, method, pathname, correlationID, reason, "", 0, body, target)
}
func (c *Client) doWithContext(ctx context.Context, method, pathname, correlationID, reason, operatorActorID string, expectedVersion int, body any, target any) error {
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
	if strings.TrimSpace(reason) != "" {
		req.Header.Set("X-Reason", strings.TrimSpace(reason))
	}
	if strings.TrimSpace(operatorActorID) != "" {
		req.Header.Set("X-Acting-Actor-ID", strings.TrimSpace(operatorActorID))
		req.Header.Set("X-Actor-ID", strings.TrimSpace(operatorActorID))
	}
	if expectedVersion > 0 {
		req.Header.Set("X-Expected-Version", fmt.Sprintf("%d", expectedVersion))
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
		return &Error{Status: response.StatusCode, Code: strings.TrimSpace(payload.Error.Code), Message: strings.TrimSpace(payload.Error.Message)}
	}
	if target == nil || response.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(io.LimitReader(response.Body, 256*1024)).Decode(target)
}
