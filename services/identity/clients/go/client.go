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
	"strconv"
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
	endpoint Endpoint
	token    string
	http     *http.Client
}

// Endpoint is an already-validated Identity service origin. Its fields remain
// private so callers cannot bypass the host policy enforced by ParseEndpoint.
type Endpoint struct {
	baseURL url.URL
}

// ParseEndpoint validates an Identity service origin against exact, authorized
// hostnames. The allowlist is supplied by the owning runtime boundary; an
// arbitrary configured URL is never sufficient to authorize an HTTP target.
func ParseEndpoint(raw string, allowedHosts []string) (Endpoint, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(raw), "/")
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" {
		return Endpoint{}, errors.New("identity client base URL is invalid")
	}
	if !authorizedHostname(parsed.Hostname(), allowedHosts) {
		return Endpoint{}, errors.New("identity client base URL host is not authorized")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	return Endpoint{baseURL: *parsed}, nil
}

func authorizedHostname(hostname string, allowedHosts []string) bool {
	hostname = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(hostname)), ".")
	if hostname == "" {
		return false
	}
	for _, allowed := range allowedHosts {
		allowed = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(allowed)), ".")
		if allowed != "" && hostname == allowed {
			return true
		}
	}
	return false
}

func (e Endpoint) String() string { return e.baseURL.String() }

func New(endpoint Endpoint, serviceToken string) (*Client, error) {
	serviceToken = strings.TrimSpace(serviceToken)
	if endpoint.baseURL.Scheme == "" || endpoint.baseURL.Host == "" {
		return nil, errors.New("identity client base URL is invalid")
	}
	if len(serviceToken) < 24 {
		return nil, errors.New("identity client service token is too short")
	}
	return &Client{endpoint: endpoint, token: serviceToken, http: &http.Client{Timeout: 8 * time.Second}}, nil
}

func (c *Client) IssueOperatorEnrollmentTokenWithContext(ctx context.Context, input OperatorEnrollmentTokenIssueRequest, correlationID, operatorActorID string) (OperatorEnrollmentToken, error) {
	var result OperatorEnrollmentToken
	err := c.doWithContext(ctx, IdentityOperationIssueOperatorEnrollmentToken.Method, IdentityOperationIssueOperatorEnrollmentToken.Path, correlationID, "", operatorActorID, 0, input, &result)
	return result, err
}

func (c *Client) ProvisionRoleWithContext(ctx context.Context, input ProvisionActorRoleRequest, correlationID, operatorActorID string) (ActorRoleView, error) {
	var result ActorRoleView
	err := c.doWithContext(ctx, IdentityOperationProvisionActorRole.Method, IdentityOperationProvisionActorRole.Path, correlationID, "", operatorActorID, 0, input, &result)
	return result, err
}
func (c *Client) ReadRole(ctx context.Context, actorID, role string) (ActorRoleView, error) {
	var result ActorRoleView
	pathname := identityRoute(IdentityOperationReadActorRole.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)), "role", url.PathEscape(strings.TrimSpace(role)))
	err := c.do(ctx, IdentityOperationReadActorRole.Method, pathname, "", nil, &result)
	return result, err
}

func (c *Client) ReadOperatorPermission(ctx context.Context, actorID, permission, operatorActorID string) (OperatorPermissionAccess, error) {
	var result OperatorPermissionAccess
	pathname := identityRoute(IdentityOperationReadOperatorPermission.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)), "permission", url.PathEscape(strings.TrimSpace(permission)))
	err := c.doWithContext(ctx, IdentityOperationReadOperatorPermission.Method, pathname, "", "", strings.TrimSpace(operatorActorID), 0, nil, &result)
	return result, err
}

func (c *Client) SubmitActorLegalName(ctx context.Context, actorID string, input SubmitActorLegalNameRequest, correlationID, idempotencyKey, operatorActorID string) (ActorLegalName, error) {
	var result ActorLegalName
	pathname := identityRoute(IdentityOperationSubmitActorLegalName.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)))
	err := c.doWithLegalNameHeaders(ctx, IdentityOperationSubmitActorLegalName.Method, pathname, correlationID, idempotencyKey, operatorActorID, input, &result)
	return result, err
}

func (c *Client) VerifyActorLegalName(ctx context.Context, actorID string, version int, input VerifyActorLegalNameRequest, correlationID, idempotencyKey, operatorActorID string) (ActorLegalName, error) {
	var result ActorLegalName
	pathname := identityRoute(IdentityOperationVerifyActorLegalName.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)), "version", fmt.Sprintf("%d", version))
	err := c.doWithLegalNameHeaders(ctx, IdentityOperationVerifyActorLegalName.Method, pathname, correlationID, idempotencyKey, operatorActorID, input, &result)
	return result, err
}

func (c *Client) ReadVerifiedActorLegalName(ctx context.Context, actorID, operatorActorID string) (ActorLegalName, error) {
	var result ActorLegalName
	pathname := identityRoute(IdentityOperationReadVerifiedActorLegalName.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)))
	err := c.doWithContext(ctx, IdentityOperationReadVerifiedActorLegalName.Method, pathname, "", "", strings.TrimSpace(operatorActorID), 0, nil, &result)
	return result, err
}

func (c *Client) ReadPendingActorLegalName(ctx context.Context, actorID, operatorActorID string) (ActorLegalName, error) {
	var result ActorLegalName
	pathname := identityRoute(IdentityOperationReadPendingActorLegalName.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)))
	err := c.doWithContext(ctx, IdentityOperationReadPendingActorLegalName.Method, pathname, "", "", strings.TrimSpace(operatorActorID), 0, nil, &result)
	return result, err
}

func (c *Client) doWithLegalNameHeaders(ctx context.Context, method, pathname, correlationID, idempotencyKey, operatorActorID string, body, target any) error {
	return c.doWithIdempotency(ctx, method, pathname, c.token, correlationID, "", operatorActorID, 0, 0, idempotencyKey, body, target)
}

func (c *Client) SetOperatorPermissionWithContext(ctx context.Context, actorID, permission, operatorActorID string, enabled bool, correlationID, reason string, expectedVersion int) (OperatorPermissionAccess, error) {
	var result OperatorPermissionAccess
	pathname := identityRoute(IdentityOperationSetOperatorPermission.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)), "permission", url.PathEscape(strings.TrimSpace(permission)))
	input := SetOperatorPermissionRequest{Enabled: enabled}
	err := c.doWithContext(ctx, IdentityOperationSetOperatorPermission.Method, pathname, correlationID, reason, operatorActorID, expectedVersion, input, &result)
	return result, err
}

// ReadSession validates an end-user access token at the canonical Identity
// session boundary. The token is deliberately not sent to an internal route
// with the DSH service credential.
func (c *Client) ReadSession(ctx context.Context, accessToken string) (ActorIdentity, error) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return ActorIdentity{}, &Error{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED", Message: "access token is required"}
	}
	var result ActorIdentity
	err := c.doWithToken(ctx, IdentityOperationReadCurrentSession.Method, IdentityOperationReadCurrentSession.Path, accessToken, "", "", "", 0, 0, nil, &result)
	return result, err
}
func (c *Client) SearchRoles(ctx context.Context, role, query string) (ActorRoleSearchPage, error) {
	enabled := true
	return c.searchRoles(ctx, role, query, &enabled)
}

func (c *Client) SearchRolesAnyStatus(ctx context.Context, role, query string) (ActorRoleSearchPage, error) {
	return c.searchRoles(ctx, role, query, nil)
}

func (c *Client) searchRoles(ctx context.Context, role, query string, enabled *bool) (ActorRoleSearchPage, error) {
	params := url.Values{}
	params.Set("role", strings.TrimSpace(role))
	params.Set("q", strings.TrimSpace(query))
	if enabled != nil {
		params.Set("enabled", strconv.FormatBool(*enabled))
	}
	params.Set("limit", "2")
	var result ActorRoleSearchPage
	err := c.do(ctx, IdentityOperationSearchActorRoles.Method, IdentityOperationSearchActorRoles.Path+"?"+params.Encode(), "", nil, &result)
	return result, err
}
func (c *Client) SetRoleEnabledWithContext(ctx context.Context, actorID, role string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	operation := IdentityOperationDisableActorRole
	if enabled {
		operation = IdentityOperationEnableActorRole
	}
	pathname := identityRoute(operation.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)), "role", url.PathEscape(strings.TrimSpace(role)))
	return c.doWithContext(ctx, operation.Method, pathname, correlationID, reason, operatorActorID, expectedVersion, nil, nil)
}

func (c *Client) AuthorizeReenrollmentWithContext(ctx context.Context, actorID, role, correlationID, operatorActorID, reason string, expectedActorVersion, expectedRoleVersion int) error {
	pathname := identityRoute(IdentityOperationAuthorizeManagedRoleReenrollment.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)), "role", url.PathEscape(strings.TrimSpace(role)))
	return c.doWithContextVersions(ctx, IdentityOperationAuthorizeManagedRoleReenrollment.Method, pathname, correlationID, reason, operatorActorID, expectedRoleVersion, expectedActorVersion, nil, nil)
}

func (c *Client) SetActorSecurityEnabledWithContext(ctx context.Context, actorID string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	operation := IdentityOperationDisableActorSecurity
	if enabled {
		operation = IdentityOperationEnableActorSecurity
	}
	pathname := identityRoute(operation.Path, "actorId", url.PathEscape(strings.TrimSpace(actorID)))
	return c.doWithContext(ctx, operation.Method, pathname, correlationID, reason, operatorActorID, expectedVersion, nil, nil)
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

func (c *Client) doWithContext(ctx context.Context, method, pathname, correlationID, reason, operatorActorID string, expectedVersion int, body any, target any) error {
	return c.doWithToken(ctx, method, pathname, c.token, correlationID, reason, operatorActorID, expectedVersion, 0, body, target)
}

func (c *Client) doWithContextVersions(ctx context.Context, method, pathname, correlationID, reason, operatorActorID string, expectedVersion, expectedActorVersion int, body any, target any) error {
	return c.doWithToken(ctx, method, pathname, c.token, correlationID, reason, operatorActorID, expectedVersion, expectedActorVersion, body, target)
}

func (c *Client) doWithToken(ctx context.Context, method, pathname, token, correlationID, reason, operatorActorID string, expectedVersion, expectedActorVersion int, body any, target any) error {
	return c.doWithIdempotency(ctx, method, pathname, token, correlationID, reason, operatorActorID, expectedVersion, expectedActorVersion, "", body, target)
}

func (c *Client) doWithIdempotency(ctx context.Context, method, pathname, token, correlationID, reason, operatorActorID string, expectedVersion, expectedActorVersion int, idempotencyKey string, body any, target any) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return &Error{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED", Message: "access token is required"}
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	requestURL, err := c.requestURL(pathname)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, requestURL, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(idempotencyKey) != "" {
		req.Header.Set("Idempotency-Key", strings.TrimSpace(idempotencyKey))
	}
	if strings.TrimSpace(correlationID) != "" {
		req.Header.Set("X-Correlation-ID", strings.TrimSpace(correlationID))
	}
	if strings.TrimSpace(reason) != "" {
		req.Header.Set("X-Reason", strings.TrimSpace(reason))
	}
	if strings.TrimSpace(operatorActorID) != "" {
		req.Header.Set("X-Acting-Actor-ID", strings.TrimSpace(operatorActorID))
	}
	if expectedVersion > 0 {
		req.Header.Set("X-Expected-Version", fmt.Sprintf("%d", expectedVersion))
	}
	if expectedActorVersion > 0 {
		req.Header.Set("X-Expected-Actor-Version", fmt.Sprintf("%d", expectedActorVersion))
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

func (c *Client) requestURL(pathname string) (string, error) {
	parsedPath, err := url.ParseRequestURI(pathname)
	if err != nil || parsedPath.IsAbs() || parsedPath.Host != "" || parsedPath.User != nil || parsedPath.Fragment != "" || !strings.HasPrefix(parsedPath.Path, "/") || strings.HasPrefix(parsedPath.Path, "//") {
		return "", errors.New("identity client request path is invalid")
	}
	requestURL := c.endpoint.baseURL
	requestURL.Path = parsedPath.Path
	requestURL.RawPath = parsedPath.RawPath
	requestURL.RawQuery = parsedPath.RawQuery
	return requestURL.String(), nil
}
