# Identity Tests

Identity closure tests must falsify the semantic model, not only prove isolated happy paths.

Required adversarial coverage includes:

- same-phone multi-role identity with one permanent `actor_id`;
- customer actor creation only after phone proof;
- customer normal phone+password authentication and role-scoped recovery;
- no customer recurring activation-login path;
- current partner role admission only after domain-owned DSH eligibility, with no generic Captain/Field admission endpoint;
- one-time managed activation plus explicit Control Panel actor_id-addressed re-enrollment authorization;
- Operator password login/session creation and SMS normal-login fallback = zero;
- user-verified, discoverable Operator WebAuthn registration/authentication;
- wrong RP/origin/credential/signature, UV=false, expired/replayed ceremony, disabled role/security and revoked credential rejection;
- governed Operator enrollment plus one-use recovery credential, phone proof, authenticator/session revocation and credential rotation;
- credential-derived internal service principal;
- role-scoped disable/revocation and Platform-Control-only global security disable/re-enable;
- operator/client credential separation on the same actor;
- password-reset revocation without cross-role revocation;
- challenge/password abuse controls;
- `clientInstanceId`-bound refresh rotation/replay behavior;
- zero legacy universal-OTP, username, context/caller-header or actor-global role/credential residue.

A green suite using a different actor for every role or proving only one authentication class is insufficient closure evidence.
