# External References — Identity, HR References and Platform Control

DOCUMENT_CLASS: NON_AUTHORITATIVE_EXTERNAL_REFERENCE
EXECUTION_AUTHORITY: NONE
PRODUCT_AUTHORITY: NONE
CURRENT_REPOSITORY_STATE_AUTHORITY: NONE


### 1B.7 Identity / authentication / sessions

**P1 — Keycloak**
- Repository: https://github.com/keycloak/keycloak
- Docs: https://www.keycloak.org/documentation
- Use for: mature authentication, sessions, OAuth2/OIDC/SAML, MFA, federation and security administration.

**P2 — ZITADEL**
- Repository: https://github.com/zitadel/zitadel
- Docs: https://zitadel.com/docs
- Use for: modern multi-tenant/B2B identity, organizations, roles and audit.

**P3 — Ory**
- GitHub: https://github.com/ory
- Docs: https://www.ory.sh/docs/
- Use for: API-first identity/session architecture and separation of identity components.

**P4 — Authentik**
- Repository: https://github.com/goauthentik/authentik
- Docs: https://docs.goauthentik.io/
- Use for federation/SSO/provider flows and operator administration.

**P5 — SuperTokens**
- Repository: https://github.com/supertokens/supertokens-core
- Docs: https://supertokens.com/docs
- Use for application-centric sessions/login edge cases.

### 1B.8 Fine-grained authorization / permissions

**P1 — OpenFGA**
- Repository: https://github.com/openfga/openfga
- Docs: https://openfga.dev/docs
- Use for relationship-based/Zanzibar-style authorization.

**P2 — Keycloak Authorization Services**
- Docs: https://www.keycloak.org/docs/latest/authorization_services/
- Use for RBAC/ABAC/context/resource/scope policy models.

**P3 — Ory Keto**
- Repository: https://github.com/ory/keto
- Docs: https://www.ory.sh/keto/docs/
- Use for a second relationship/permission architecture.

**P4 — Cerbos**
- Repository: https://github.com/cerbos/cerbos
- Docs: https://docs.cerbos.dev/
- Use for policy decision/enforcement separation.

**P5 — Casbin**
- Repository: https://github.com/casbin/casbin
- Docs: https://casbin.org/docs/
- Use for compact RBAC/ABAC comparison.

### 1B.9 Notifications / inbox / preferences / multi-channel delivery

**P1 — Knock**
- Docs: https://docs.knock.app/
- Use for: mature notification workflows, in-app feed/inbox, preferences, routing, batching/digests and multi-channel semantics.

**P2 — Courier**
- Docs: https://www.courier.com/docs/
- Use for: routing, preference centers, channel choices, templates and notification API concepts.

**P3 — Novu**
- Repository: https://github.com/novuhq/novu
- Docs: https://docs.novu.co/
- Use for inspectable open-source workflow/inbox/preferences behavior.

**P4 — OneSignal**
- Docs: https://documentation.onesignal.com/
- Use for mobile push delivery, segmentation and push lifecycle.

**P5 — Braze**
- Docs: https://www.braze.com/docs/
- Use only for advanced enterprise messaging/personalization counterexamples.

Source business facts remain owned by DSH/WLT/etc.; notification references do not become business authority.

### 1B.14 HR / employee lifecycle references (future-adoption only)

These references do not imply a current Workforce service, module, or bounded context. Adopt an enterprise HR boundary only if concrete future cross-domain lifecycle/data/rule requirements independently justify it.

**P1 — Odoo HR**
- Docs: https://www.odoo.com/documentation/
- Use for employee, attendance, time-off, recruitment and operational HR workflows.

**P2 — ERPNext HR**
- Docs: https://docs.frappe.io/erpnext
- Use for employee records, shifts, attendance and onboarding.

**P3 — OrangeHRM**
- Repository: https://github.com/orangehrm/orangehrm
- Use for dedicated HR lifecycle comparison.

**P4 — Workday public concepts**
- Entry: https://www.workday.com/
- Use only for high-level enterprise HR falsification where public material is sufficient.

Do not overload Identity actor truth with domain-specific participant state, and do not invent a generic people/workforce service merely to group roles.

### 1B.16 Feature flags / configuration / Platform Control

**P1 — LaunchDarkly**
- Docs: https://docs.launchdarkly.com/
- Use for mature flag lifecycle, targeting, environments, rollout and audit.

**P2 — OpenFeature**
- GitHub: https://github.com/open-feature
- Docs: https://openfeature.dev/docs/
- Use for vendor-neutral feature-flag API semantics.

**P3 — Unleash**
- Repository: https://github.com/Unleash/unleash
- Docs: https://docs.getunleash.io/
- Use for inspectable flag strategy/environments/rollout.

**P4 — Flagsmith**
- Repository: https://github.com/Flagsmith/flagsmith
- Docs: https://docs.flagsmith.com/
- Use for another open remote-config/flag model.

Feature flags do not authorize Platform Control to own unrelated business configuration.

### 1B.20 Secrets / credentials / sensitive configuration

**P1 — HashiCorp Vault**
- Repository: https://github.com/hashicorp/vault
- Docs: https://developer.hashicorp.com/vault/docs
- Use for secret references, leases, rotation, dynamic secrets and audit.

**P2 — AWS Secrets Manager**
- Docs: https://docs.aws.amazon.com/secretsmanager/
- Use for managed secret versioning/rotation/injection patterns.

**P3 — SOPS**
- Repository: https://github.com/getsops/sops
- Use for encrypted configuration/secrets workflow concepts.

**P4 — Doppler**
- Docs: https://docs.doppler.com/
- Use as a managed secrets/config developer-experience counterexample.
