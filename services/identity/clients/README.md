# Identity Clients

Canonical Identity-owned client bindings live here.

Rules:
- DTO lineage originates from `contracts/identity.openapi.yaml`;
- customer registration/login/recovery and managed activation are distinct typed operations;
- operator password-start and second-factor completion are distinct typed operations;
- app sessions consume one role only;
- mobile SecureStore/keychain and control-panel HttpOnly cookies remain host adapters;
- internal service identity comes from its configured bearer credential, not `X-Service-Caller`;
- no direct internal-route client, legacy universal OTP flow, generic context object or compatibility re-export may become a second authority.
