# Repository tooling

`tools/` contains only repository-wide utilities. Product and architecture authority live elsewhere.

- `dev/` — local feedback, backend lifecycle, surface launch and device transport.
- `go/` — Go workspace checks used by Nx.
- `mobile/` — mobile build/configuration tooling shared by the apps.
- `powershell/` — repository-wide PowerShell syntax check.
- `security/` — repository secret-safety scan.

Owner-specific tooling belongs with its app, service or package. Cross-owner runtime/integration proofs live under `tests/runtime/`.

Daily local commands are defined by the live root/app `package.json` files. Do not add a wrapper when a standard command or existing owner already solves the problem.
