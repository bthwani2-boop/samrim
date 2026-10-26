import assert from "node:assert/strict";
import { test } from "node:test";
import { tryAcquireFieldDraftMutation } from "./field-draft-mutation-lock.ts";

test("a synchronous duplicate draft submit is rejected before a second request", () => {
  const lock = { current: false };
  assert.equal(tryAcquireFieldDraftMutation(lock), true);
  assert.equal(tryAcquireFieldDraftMutation(lock), false);
  lock.current = false;
  assert.equal(tryAcquireFieldDraftMutation(lock), true);
});

// Invalid phone exits early from the form handler and must not acquire a persistent lock.
test("draft mutation lock is acquired only after phone validation and attempt creation", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./field-new-case.tsx", import.meta.url), "utf8");
  const phoneValidation = source.indexOf('if (!/^\\+[1-9]\\d{7,14}$/.test(contactPhoneE164))');
  const lockAcquire = source.indexOf('if (!tryAcquireFieldDraftMutation(draftMutationLock)) return;');
  const attemptCreated = source.indexOf('setPendingDraftAttempt(attempt);');
  const mutationTry = source.indexOf('    try {', attemptCreated);
  const releaseInFinally = source.indexOf('draftMutationLock.current = false;', mutationTry);
  assert.ok(phoneValidation >= 0 && lockAcquire > phoneValidation, "invalid phone must exit before lock acquisition");
  assert.ok(attemptCreated > lockAcquire, "lock must precede mutation submission");
  assert.ok(mutationTry > attemptCreated && releaseInFinally > mutationTry, "lock is released by the mutation's finally block");
});
