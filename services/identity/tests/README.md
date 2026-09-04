# Identity Tests

Identity closure tests must falsify the semantic model, not only prove isolated happy paths.

Required adversarial coverage includes same-phone multi-role identity, governed OTP non-grant, credential-derived service principal, role-scoped disable/revocation, operator multi-role login, password-reset revocation, account-lockout DoS resistance, OTP throttling, refresh rotation/replay behavior and zero legacy context/caller-header/role-array residue.

A green suite using a different actor for every role is insufficient closure evidence.
