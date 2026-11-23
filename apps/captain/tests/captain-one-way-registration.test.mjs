import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const route = path => readFileSync(new URL(path, root), "utf8");
test("Captain public form route exists separately from Identity session and operational standing", () => {
  const source = route("app/join.tsx");
  assert.match(source, /captain-interest-screen/);
  assert.doesNotMatch(source, /admission-transport|CaptainProtectedRoute|requestCaptainApplication/);
});
test("Captain first login screen links to one-way registration underneath login", () => {
  const login = route("src/features/access/identity-gate.tsx");
  assert.match(login, /href=\{"\/join" as Href\}/);
  assert.match(login, /انضم إلى كباتن بثواني/);
});
test("Candidate screen uses only public DSH intake and never reads an application status", () => {
  const form = route("src/features/join/captain-interest-screen.tsx");
  assert.match(form, /submitCaptainInterest/);
  assert.doesNotMatch(form, /readCaptainApplication|requestCaptainApplication|CaptainProtectedRoute|readCaptainAdmission|IdentityClient/);
  assert.match(form, /تم استلام بياناتك/);
});
