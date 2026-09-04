# Identity Clients

Canonical Identity-owned client bindings live here.

Rules:
- DTO lineage originates from `contracts/identity.openapi.yaml`;
- app sessions consume one role only;
- mobile SecureStore/keychain and control-panel HttpOnly cookies remain host adapters;
- internal service identity comes from its configured bearer credential, not `X-Service-Caller`;
- no `X-Operator-Context-ID`, direct internal-route client, legacy actor-role array or compatibility re-export may become a second authority.
