# Identity Clients

This room is reserved for the canonical Identity-owned client surface.

Rules:

- generated DTO/binding lineage must originate from the canonical Identity contract;
- session/auth semantics remain Identity-owned;
- app-native bindings such as SecureStore/keychain remain app-owned adapters;
- no compatibility re-export of `@bthwani/core-identity` is allowed;
- no manually duplicated Identity DTO/role/permission/session registry may become a second authority.

Required client code will be migrated/refounded here only when its contract and consumer cutover are executed.
