# Security and Privacy Policy

ARTIFACT_CLASS: DURABLE_SECURITY_PRIVACY_POLICY
SEMANTIC_OWNER: governance/policies/security.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Governing security model

Security follows canonical Product/System ownership rather than creating a second business model. Authentication establishes identity; authorization separately enforces trusted context, permission, object/business scope, legal state and ownership. Security controls fail closed when required trust cannot be proven.

## Identity and authorization

- Every protected read/write is authorized server-side; UI visibility is never authorization.
- Trusted platform/operator/service context is derived from authenticated server-side state or governed delegation and cannot be granted/overridden by client-controlled headers, queries, bodies, local storage or UI selection.
- Partner/store/customer/captain/field/operator boundaries are enforced by the owning backend and, where appropriate, durable data constraints.
- Object-level authorization is required in addition to route/role authorization where identifiers select owned/sensitive resources; possession or guessability of an ID never grants access.
- Cross-scope not-found/forbidden behavior must not unnecessarily disclose existence or ownership of protected resources.
- Administrative/support/break-glass access is explicitly scoped, attributable, auditable and no broader than the operational need.

## Untrusted input and attack-surface boundaries

Treat all client, provider, file, URL, path, webhook, import/export and external-system input as untrusted until validated at the owning boundary.

Apply materially relevant protections for:

`injection | IDOR/object-scope bypass | SSRF | path traversal | unsafe file/upload handling | schema/body/size abuse | malformed content | replay | duplicate requests | rate/abuse amplification | unsafe redirects/URLs | cross-origin/session misuse`.

Validation is semantic as well as syntactic: a well-formed value cannot override trusted ownership, monetary truth, authorization scope or legal state. File/media handling must constrain accepted type/size/content/storage/access behavior and never trust a filename or client MIME claim as security authority.

Network/provider destinations that can be influenced by untrusted input require allowlisted/owned resolution semantics sufficient to prevent access to unintended internal/local metadata or privileged endpoints.

Rate/abuse controls are applied where an operation can materially consume resources, enumerate sensitive state, brute-force credentials/codes, amplify provider cost or create repeated financial/operational effects. Rate limiting does not replace idempotency or authorization.

## Sessions and credentials

- Passwords, OTP/activation codes, tokens, signing keys, service credentials, provider secrets and recovery credentials are never logged or stored in plaintext outside their approved secure store.
- Session/refresh/revocation/activation behavior is explicit and replay-safe where required.
- Revoked, expired, suspended or replaced trust must not survive through client cache/local state or an alternate session path.
- Credential comparison/verification and token/cookie/session transport/storage use the owning platform/framework's current secure primitives; do not invent custom cryptography for convenience.
- Client/mobile/web bundles contain no server secret, privileged provider credential or private signing material.

## Service and provider security

- Privileged service-to-service operations use explicit authenticated service identity and least privilege.
- Provider webhooks use signature/authentication verification, replay/timestamp protection where supported/required, schema/body limits, stable event identity and idempotent processing.
- Provider-specific secrets/payloads terminate at their adapter/owner boundary; downstream domains consume governed normalized facts.
- Missing trusted context, permission, secret, signature, provider identity or security-critical configuration fails closed.
- Unknown/ambiguous external mutation outcomes remain unresolved/reconcilable; security/reliability uncertainty must not be converted into fabricated success or a second provider attempt that can duplicate the effect.

## Privacy and data lifecycle

Privacy is a lifecycle property, not only access control. For materially handled personal/sensitive data, be able to trace:

```text
data element
-> declared Product/operational purpose
-> canonical owner
-> allowed actors/scopes
-> collection/minimization
-> validation/classification
-> storage/protection
-> transport
-> projections/caches
-> logs/traces/analytics/support/evidence exposure
-> retention
-> masking/redaction
-> export/share
-> deletion/anonymization/reconciliation where applicable
```

- Collect only data required by current Product/contracts and a legitimate current purpose.
- Restrict reads/projections/exports by purpose, actor, object and business scope; redact fields not required by a consumer.
- Retain sensitive data only for the governed operational/legal/audit need. A durable retention requirement must have an owner; absence of a material required retention/deletion decision is a governance gap rather than permission to retain forever.
- Deletion/anonymization must respect canonical ownership, references, legal/audit/financial retention and reconciliation. Deleting a projection does not delete owner truth; deleting owner truth without resolving required consumers/references is not privacy closure.
- Production PII, credentials, identity documents, precise location history and financial payloads are not ordinary local/staging/test data. Exceptional diagnostic use must be authorized, minimized/sanitized, protected, time-bounded and removed after purpose.

## Sensitive logging, telemetry, and evidence

Logs, traces, analytics, support artifacts, screenshots, crash reports and test/security evidence must avoid unnecessary PII, precise location history, document contents, full financial identifiers/payloads, tokens, credentials and secrets. Prefer opaque IDs/correlation IDs and masked values when sufficient.

Telemetry requires a real Product/Operations/Security decision purpose; do not create durable user profiling or copy sensitive payloads merely because an analytics tool permits it.

## Financial security

- WLT is the sole authoritative financial-truth owner.
- Financial mutations require authenticated server-side context, idempotency/correlation, legal state transition and owner-side validation of server-derived monetary truth.
- Payout destinations/beneficiaries and other sensitive financial execution data are verified/versioned before use; material changes require renewed validation rather than silent trust transfer.
- Full financial identifiers are protected in storage and masked by default; unmasked access/export is restricted and auditable.
- Beneficiary/client/operator input may express governed intent/evidence but cannot directly overwrite authoritative balance, ledger, earning, fee, commission, payout or reconciliation values.
- Manual files/screenshots/operator assertions may support investigation/execution evidence but cannot establish authoritative wallet/ledger truth.
- Reconciliation mismatch or unknown external mutation outcome remains unresolved/fail-closed until the owning system can prove the result.
- Separation-of-duties/maker-checker/step-up behavior is enforced server-side where current Product/financial policy requires it; the UI cannot self-authorize an exception.

## Dependencies, generated artifacts, and supply-chain security

- Required dependencies/actions are pinned/locked according to executable repository/delivery policy and originate from authorized sources.
- Generated artifacts retain provenance to their canonical source and are regenerated rather than hand-forked.
- Build/release artifacts and sensitive signing/deployment identities follow `delivery.md`; security policy does not create a parallel release process.
- A dependency, SDK or asset that can materially alter permissions, privacy, network behavior, native capability or supply-chain risk requires applicable ownership/review/evidence.

## Evidence and blocking conditions

Use the smallest security evidence capable of falsifying the affected claim, then deepen by risk. Static analysis proves only its covered source patterns; runtime authorization/session/isolation/provider/file/network claims require targeted runtime/integration/adversarial evidence where material.

Critical authentication/authorization bypass, secret exposure, cross-scope access, isolation failure, unsafe privileged input path or material financial-security failure blocks the affected outcome until root-correct treatment or an explicit legitimate unresolved stop state. Do not create security approval registries or governance gates as substitutes for actual security evidence.


## Development/bootstrap credential boundary

Development/bootstrap credentials or historical examples never define normal Identity credential policy. OTP/challenge lifecycle remains Identity-owned; SMS/email/push are delivery channels only. Development inspection mechanisms must be explicitly development-only and impossible to enable accidentally in production.


## OTP, challenge and privileged-authentication law

OTP/challenge lifecycle is an Identity capability. SMS, email or any other channel is delivery only.

```text
OTP_ENGINE != SMS_PROVIDER
OTP_CHALLENGE_STATE → IDENTITY
OTP_DELIVERY → CHANNEL_ADAPTER
```

Development/bootstrap credentials or historical examples never define normal credential policy. Fixed universal development OTP values are forbidden as a normal Identity mechanism.

Material OTP abuse controls must support bounded server-side policy across the applicable dimensions, including:

- per-phone challenge/request rate;
- per-IP rate;
- per-device/session/client risk dimension where available and justified;
- resend/cooldown/expiry/attempt limits;
- provider/channel spend or abuse limits where external delivery cost can be exploited;
- replay/single-use enforcement;
- audit/correlation without logging raw OTP values.

Exact thresholds are configuration/policy values and must not be invented in governance.

Raw OTPs must not enter production logs, traces, analytics or general audit records.

For privileged Control Panel/operator authentication, architecture must remain capable of stronger factors such as TOTP and Passkeys/WebAuthn. These are authentication methods, not SMS delivery channels.


## Threat boundaries and data classification

Treat these as explicit trust boundaries:

- untrusted public/mobile/web clients;
- trusted-but-scoped operators;
- service-to-service callers;
- external provider callbacks/webhooks;
- uploaded documents/media;
- financial mutations/reconciliation;
- development/test environments.

At each boundary validate identity, authorization/scope, input/schema, replay/idempotency, provenance and sensitive-data handling as applicable.

Data handling distinguishes at minimum:

- public/non-sensitive content;
- internal operational data;
- personal/location/workforce data;
- authentication/credential/secret material;
- financial/payment/payout/reconciliation evidence.

The owning policy/configuration defines retention/residency/erasure requirements. Do not invent fixed retention, RPO or RTO values without approved evidence.

Sensitive classes are minimized, encrypted/protected according to risk, redacted in observability/audit, and exposed only to the minimum authorized consumer.
