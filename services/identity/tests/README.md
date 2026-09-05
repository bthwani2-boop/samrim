# Identity Tests

Identity closure tests must falsify the semantic model, not only prove isolated happy paths.

Required adversarial coverage includes:

- same-phone multi-role identity with one permanent `actor_id`;
- customer actor creation only after phone proof;
- customer normal phone+password authentication and role-scoped recovery;
- no customer recurring activation-login path;
- governed partner/captain/field role provisioning before activation;
- one-time managed activation plus explicit DSH-authorized re-enrollment;
- password-only operator session creation = zero;
- required operator second-factor challenge before session creation;
- credential-derived internal service principal;
- role-scoped disable/revocation and Platform-Control-only global security disable/re-enable;
- operator/client credential separation on the same actor;
- password-reset revocation without cross-role revocation;
- challenge/password abuse controls;
- device-bound refresh rotation/replay behavior;
- zero legacy universal-OTP, username, context/caller-header or actor-global role/credential residue.

A green suite using a different actor for every role or proving only one authentication class is insufficient closure evidence.
