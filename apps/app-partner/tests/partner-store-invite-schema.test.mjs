import test from "node:test";
import assert from "node:assert/strict";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFormControl } from "react-hook-form";
import { inviteDetailsSchema } from "../src/features/partner-onboarding/partner-store-invite-schema.ts";

test("valid E.164 invitations retain submitted identity", async () => {
  const resolver = zodResolver(inviteDetailsSchema);
  const result = await resolver({ phone: " +967771234567 ", displayName: " متجر تجريبي " }, {}, {});
  assert.deepEqual(result.errors, {});
  assert.equal(result.values.phone, "+967771234567");
  assert.equal(result.values.displayName, "متجر تجريبي");
});
test("bad phone and empty display name are denied before submission", async () => {
  const form = createFormControl({
    defaultValues: { phone: "771234567", displayName: " " },
    resolver: zodResolver(inviteDetailsSchema),
    mode: "onChange",
  });
  const valid = await form.trigger();
  assert.equal(valid, false);
  assert.ok(form.getFieldState("phone").error);
  assert.ok(form.getFieldState("displayName").error);
});
test("input validation cannot replace server-side authority", () => {
  const parsed = inviteDetailsSchema.safeParse({ phone: "+967771234567", displayName: "موظف" });
  assert.equal(parsed.success, true);
  assert.equal("permissions" in parsed.data, false);
});
