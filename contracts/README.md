# Contracts

Root `contracts/` is reserved for genuinely cross-service protocol primitives, generated/discovery catalog material, and their verification tooling.

Service-owned business API/event/schema contracts remain sovereign under:

```text
services/<owner>/contracts/
```

This root must not own DSH, WLT, Identity, or other service business operations merely because multiple consumers use them.

Generated clients and other derived artifacts are never independent sources of truth and must retain explicit lineage to their canonical service or cross-service contract.
