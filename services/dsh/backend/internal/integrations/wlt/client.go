package wlt

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	MethodCashOnDelivery          = "CASH_ON_DELIVERY"
	methodCashOnDelivery          = MethodCashOnDelivery
	MethodCashAtStore             = "CASH_AT_STORE"
	stateRequiresCollect          = "REQUIRES_COLLECTION"
	stateCollected                = "COLLECTED"
	stateCancelled                = "CANCELLED"
	customerWithdrawalIntakesPath = "/wlt/v1/operator/customer-withdrawal-intakes"
	orderAdjustmentCasesPath      = "/wlt/v1/order-adjustment-reconciliation-cases"
	payoutRequestsPath            = "/wlt/v1/operator/payout-requests"
	settlementBatchesPath         = "/wlt/v1/operator/settlement-batches"
)

var ErrFieldPayoutBatchInvalidInput = errors.New("field payout state batch input is invalid")

type Client struct {
	baseURL                 string
	serviceToken            string
	rootApprovalProofSecret []byte
	httpClient              *http.Client
}

type actorRequest struct {
	method          string
	path            string
	body            any
	idempotencyKey  string
	correlationID   string
	expectedVersion int
	actingActorID   string
	target          any
}

type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("WLT request failed with status %d and code %s: %s", e.Status, e.Code, e.Message)
}

func New(rawBaseURL, environment, serviceToken string, rootApprovalProofSecrets ...string) (*Client, error) {
	baseURL, err := ResolveBaseURL(rawBaseURL, environment)
	if err != nil {
		return nil, err
	}
	serviceToken = strings.TrimSpace(serviceToken)
	if serviceToken == "" {
		return nil, errors.New("WLT service token is required")
	}
	var proofKey []byte
	if len(rootApprovalProofSecrets) > 1 {
		return nil, errors.New("at most one Root Owner proof key is allowed")
	}
	if len(rootApprovalProofSecrets) == 1 {
		key := strings.TrimSpace(rootApprovalProofSecrets[0])
		if key != "" && len(key) < 32 {
			return nil, errors.New("Root Owner proof key is too short")
		}
		proofKey = []byte(key)
	}
	return &Client{baseURL: baseURL, serviceToken: serviceToken, rootApprovalProofSecret: proofKey, httpClient: &http.Client{Timeout: 8 * time.Second}}, nil
}

// rootOwnerApprovalProof binds the DSH-verified Identity Root Owner decision to
// the exact WLT mutation. The independent key prevents a bearer of the ordinary
// DSH-WLT service token from forging a separation-of-duties exception.
func (c *Client) rootOwnerApprovalProof(agreementID string, input StoreCommercialAgreementDecision, idempotencyKey, correlationID, actorID string) (string, error) {
	if !input.RootOwnerSelfApproval {
		return "", nil
	}
	if len(c.rootApprovalProofSecret) < 32 {
		return "", errors.New("Root Owner approval proof key is unavailable")
	}
	modes := append([]string(nil), input.CurrentFulfillmentModes...)
	for i := range modes {
		modes[i] = strings.TrimSpace(modes[i])
	}
	sort.Strings(modes)
	facts, err := json.Marshal([]any{
		"wlt-root-owner-approval-v2", strings.TrimSpace(agreementID), strconv.Itoa(input.AgreementVersion),
		strings.ToUpper(strings.TrimSpace(input.Decision)), strings.TrimSpace(actorID),
		strings.TrimSpace(input.Reason), strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID),
		strings.TrimSpace(input.CurrentStorePartnerActorID), modes,
	})
	if err != nil {
		return "", err
	}
	signature := hmac.New(sha256.New, c.rootApprovalProofSecret)
	_, _ = signature.Write(facts)
	return base64.RawURLEncoding.EncodeToString(signature.Sum(nil)), nil
}

func ResolveBaseURL(raw, environment string) (string, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if environment != "development" && environment != "test" && environment != "staging" && environment != "production" {
		return "", errors.New("BTHWANI_ENV must be development, test, staging, or production")
	}
	value := strings.TrimRight(strings.TrimSpace(raw), "/")
	if value == "" {
		if environment == "development" || environment == "test" {
			value = "http://wlt:8083"
		} else {
			return "", errors.New("DSH_WLT_API_BASE_URL is required outside local environments")
		}
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("DSH_WLT_API_BASE_URL is invalid")
	}
	if (environment == "staging" || environment == "production") && parsed.Scheme != "https" {
		return "", errors.New("DSH_WLT_API_BASE_URL must use HTTPS outside local environments")
	}
	return value, nil
}

func DerivedIdempotencyKey(scope, source string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(scope) + "\x00" + strings.TrimSpace(source)))
	return "wlt-" + hex.EncodeToString(digest[:])
}

func DerivedExternalReference(scope, source string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(scope) + "\x00" + strings.TrimSpace(source)))
	return "dsh-" + strings.TrimSpace(scope) + "-" + hex.EncodeToString(digest[:])
}

func (c *Client) request(ctx context.Context, method, path string, body any, idempotencyKey, correlationID string, expectedVersion int, target any) error {
	return c.requestWithActor(ctx, actorRequest{method: method, path: path, body: body, idempotencyKey: idempotencyKey, correlationID: correlationID, expectedVersion: expectedVersion, actingActorID: "", target: target})
}

func (c *Client) requestWithActor(ctx context.Context, input actorRequest) error {
	if c == nil || c.httpClient == nil || strings.TrimSpace(c.baseURL) == "" || strings.TrimSpace(c.serviceToken) == "" {
		return errors.New("WLT client is not configured")
	}
	var reader io.Reader
	if input.body != nil {
		encoded, err := json.Marshal(input.body)
		if err != nil {
			return err
		}
		reader = strings.NewReader(string(encoded))
	}
	request, err := http.NewRequestWithContext(ctx, input.method, c.baseURL+input.path, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+c.serviceToken)
	if input.body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(input.idempotencyKey) != "" {
		request.Header.Set("Idempotency-Key", strings.TrimSpace(input.idempotencyKey))
	}
	if strings.TrimSpace(input.correlationID) != "" {
		request.Header.Set("X-Correlation-ID", strings.TrimSpace(input.correlationID))
	}
	if input.expectedVersion > 0 {
		request.Header.Set("X-Expected-Version", fmt.Sprintf("%d", input.expectedVersion))
	}
	if strings.TrimSpace(input.actingActorID) != "" {
		request.Header.Set("X-Acting-Actor-ID", strings.TrimSpace(input.actingActorID))
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if !targetedStatus(response.StatusCode) {
		var payload struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return &Error{Status: response.StatusCode, Code: payload.Error.Code, Message: payload.Error.Message}
	}
	if input.target == nil {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(input.target)
}

func targetedStatus(status int) bool {
	return status >= http.StatusOK && status < http.StatusMultipleChoices
}

type CaptainMinimumBalancePolicy struct {
	ID                    string  `json:"id"`
	Version               int     `json:"version"`
	MinimumAvailableMinor int64   `json:"minimumAvailableMinor"`
	Currency              string  `json:"currency"`
	State                 string  `json:"state"`
	CreatedBy             string  `json:"createdBy"`
	ChangeReason          string  `json:"changeReason"`
	CreatedAt             string  `json:"createdAt"`
	RetiredAt             *string `json:"retiredAt"`
}

func (c *Client) ReadCaptainMinimumBalancePolicy(ctx context.Context) (CaptainMinimumBalancePolicy, error) {
	var v struct {
		Policy CaptainMinimumBalancePolicy `json:"policy"`
	}
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/captain-minimum-balance-policy", nil, "", "", 0, &v)
	return v.Policy, err
}
func (c *Client) ListCaptainMinimumBalancePolicyHistory(ctx context.Context) ([]CaptainMinimumBalancePolicy, error) {
	var v struct {
		Items []CaptainMinimumBalancePolicy `json:"items"`
	}
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/captain-minimum-balance-policy/history?limit=50", nil, "", "", 0, &v)
	return v.Items, err
}
func (c *Client) CreateCaptainMinimumBalancePolicy(ctx context.Context, amount int64, expected int, reason, idem, correlation, actor string) (CaptainMinimumBalancePolicy, bool, error) {
	var v struct {
		Policy           CaptainMinimumBalancePolicy `json:"policy"`
		IdempotentReplay bool                        `json:"idempotentReplay"`
	}
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/captain-minimum-balance-policy",
		body:           map[string]any{"minimumAvailableMinor": amount, "expectedVersion": expected, "reason": reason},
		idempotencyKey: idem, correlationID: correlation, actingActorID: actor, target: &v})
	return v.Policy, v.IdempotentReplay, err
}

type OperatorPolicyRegistry struct {
	DeliveryFees  []OperatorFeeBrief    `json:"deliveryFees"`
	FieldRewards  []OperatorRewardBrief `json:"fieldRewards"`
	DeliveryTotal int64                 `json:"deliveryTotal"`
	FieldTotal    int64                 `json:"fieldTotal"`
}
type OperatorFeeBrief struct {
	ServiceCityID string                 `json:"serviceCityId"`
	DistanceBands []DeliveryDistanceBand `json:"distanceBands"`
	PolicyVersion string                 `json:"policyVersion"`
	Version       int                    `json:"version"`
	CreatedAt     string                 `json:"createdAt"`
	CreatedBy     string                 `json:"createdBy"`
}
type OperatorRewardBrief struct {
	ScopeType   string `json:"scopeType"`
	ScopeID     string `json:"scopeId"`
	RewardMinor int64  `json:"rewardMinor"`
	Version     int    `json:"version"`
	CreatedAt   string `json:"createdAt"`
	CreatedBy   string `json:"createdBy"`
}

func (c *Client) ReadOperatorPolicyRegistry(ctx context.Context) (OperatorPolicyRegistry, error) {
	var v OperatorPolicyRegistry
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/policy-registry", nil, "", "", 0, &v)
	return v, err
}

type PolicyChange struct {
	ID        string `json:"id"`
	ScopeID   string `json:"scopeId"`
	Version   int    `json:"version"`
	ActorID   string `json:"actorId"`
	CreatedAt string `json:"createdAt"`
	Reason    string `json:"reason"`
	Field     string `json:"field"`
	Before    string `json:"before"`
	After     string `json:"after"`
}

func (c *Client) ReadOperatorPolicyHistory(ctx context.Context, key, scopeID string) ([]PolicyChange, error) {
	var body struct {
		Items []PolicyChange `json:"items"`
	}
	query := url.Values{"key": []string{key}, "scopeId": []string{scopeID}}
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/policy-history?"+query.Encode(), nil, "", "", 0, &body)
	return body.Items, err
}

func (c *Client) ReadDistanceBandFeePolicy(ctx context.Context, city string) (DeliveryFeePolicy, error) {
	var reply deliveryFeePolicyResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/distance-band-fee-policies?serviceCityId="+url.QueryEscape(strings.TrimSpace(city)), nil, "", "", 0, &reply)
	return reply.Policy, err
}
func (c *Client) CreateDistanceBandFeePolicy(ctx context.Context, city string, bands []DeliveryDistanceBand, version int, reason, idem, correlation, actor string) (DeliveryFeePolicy, bool, error) {
	var reply deliveryFeePolicyResponse
	err := c.requestWithActor(ctx, actorRequest{method: http.MethodPost, path: "/wlt/v1/operator/distance-band-fee-policies",
		body:           map[string]any{"serviceCityId": city, "distanceBands": bands, "expectedVersion": version, "reason": reason},
		idempotencyKey: idem, correlationID: correlation, actingActorID: actor, target: &reply})
	return reply.Policy, reply.IdempotentReplay, err
}
