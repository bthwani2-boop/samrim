import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldOpenWorkspaceSearch } from "../src/shell/workspace-search-shortcut.ts";

const event = (overrides = {}) => ({
  key: "k",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
  target: null,
  ...overrides,
});

test("Ctrl+K and Command+K open workspace search outside editable fields", () => {
  assert.equal(shouldOpenWorkspaceSearch(event()), true);
  assert.equal(shouldOpenWorkspaceSearch(event({ ctrlKey: false, metaKey: true, key: "K" })), true);
});

test("ordinary typing and unrelated keyboard combinations are left alone", () => {
  assert.equal(shouldOpenWorkspaceSearch(event({ ctrlKey: false })), false);
  assert.equal(shouldOpenWorkspaceSearch(event({ key: "p" })), false);
  assert.equal(shouldOpenWorkspaceSearch(event({ altKey: true })), false);
  assert.equal(shouldOpenWorkspaceSearch(event({ shiftKey: true })), false);
  assert.equal(shouldOpenWorkspaceSearch(event({ defaultPrevented: true })), false);
});

test("the shortcut never steals input, select, textarea or rich-text editing", () => {
  for (const tag of ["input", "textarea", "select", "contenteditable"]) {
    assert.equal(shouldOpenWorkspaceSearch(event({ target: { closest: (selector) => selector.includes(tag) ? {} : null } })), false, tag);
  }
  assert.equal(shouldOpenWorkspaceSearch(event({ target: { isContentEditable: true } })), false);
  assert.equal(shouldOpenWorkspaceSearch(event({ target: { closest: () => null } })), true);
});
