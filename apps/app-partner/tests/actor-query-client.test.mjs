import test from "node:test";
import assert from "node:assert/strict";

import { createPartnerActorQueryClient } from "../src/bootstrap/actor-query-client.ts";

test("a new actor cannot see the former actor's accessible stores", async () => {
  const previous = createPartnerActorQueryClient();
  const key = ["partner", "accessible-stores"];
  const first = [{ id: "store-a", owned: true, permissions: ["orders"] }];
  await previous.fetchQuery({ queryKey: key, queryFn: async () => first });
  assert.deepEqual(previous.getQueryData(key), first);
  const next = createPartnerActorQueryClient();
  assert.equal(next.getQueryData(key), undefined);
  const second = [{ id: "store-b", owned: false, permissions: ["catalog"] }];
  await next.fetchQuery({ queryKey: key, queryFn: async () => second });
  assert.deepEqual(next.getQueryData(key), second);
  assert.deepEqual(previous.getQueryData(key), first);
  previous.clear(); // Explicit logout/actor-switch cleanup.
  assert.equal(previous.getQueryData(key), undefined);
  assert.deepEqual(next.getQueryData(key), second);
  next.clear();
});

test("no failed finance read or mutation is automatically retried", async () => {
  const client = createPartnerActorQueryClient();
  let queryAttempts = 0;
  await assert.rejects(
    client.fetchQuery({ queryKey: ["partner", "finance-failure"], queryFn: () => { queryAttempts++; throw new Error("offline"); } }),
    /offline/,
  );
  assert.equal(queryAttempts, 1);
  let mutationAttempts = 0;
  await assert.rejects(
    client.getMutationCache().build(client, {
      mutationFn: async () => { mutationAttempts++; throw new Error("needs manual reconciliation"); },
    }).execute(undefined),
    /manual reconciliation/,
  );
  assert.equal(mutationAttempts, 1);
  client.clear();
});
