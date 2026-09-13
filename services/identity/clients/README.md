# Identity Clients

Canonical Identity-owned client bindings live here.

Rules:
- DTO lineage originates from `contracts/openapi/identity.openapi.yaml` and its declared modules;
- customer registration/login/recovery and managed activation are distinct typed operations;
- Operator Passkey options/finish, governed enrollment and break-glass re-enrollment are distinct typed operations;
- app sessions consume one role only;
- mobile SecureStore/keychain and control-panel HttpOnly cookies remain host adapters;
- internal service identity comes from its configured bearer credential, not `X-Service-Caller`;
- no direct internal-route client, legacy universal OTP flow, generic context object or compatibility re-export may become a second authority.
