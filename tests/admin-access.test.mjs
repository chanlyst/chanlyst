import assert from "node:assert/strict";
import test from "node:test";
import { adminEmails, isAdminEmail } from "../app/lib/admin-access.mjs";

test("the allowlist accepts commas, spaces and newlines", () => {
  assert.deepEqual(adminEmails("a@b.com, c@d.com"), ["a@b.com", "c@d.com"]);
  assert.deepEqual(adminEmails("a@b.com\nc@d.com"), ["a@b.com", "c@d.com"]);
  assert.deepEqual(adminEmails(" a@b.com "), ["a@b.com"]);
});

test("addresses match regardless of case", () => {
  assert.equal(isAdminEmail("Info@Chanlyst.com", "info@chanlyst.com"), true);
  assert.equal(isAdminEmail("info@chanlyst.com", "INFO@CHANLYST.COM"), true);
});

// The dangerous case, and the reason the default is a closed door: an
// unset ADMIN_EMAILS is what a misconfigured deploy looks like, and it must
// read as "nobody is an admin", never as "no filter, let everyone through".
test("nothing configured admits nobody", () => {
  for (const raw of ["", null, undefined, "   ", ",,,"]) {
    assert.equal(isAdminEmail("info@chanlyst.com", raw), false);
  }
});

test("a session without an address is never an admin", () => {
  for (const email of ["", null, undefined, "   "]) {
    assert.equal(isAdminEmail(email, "info@chanlyst.com"), false);
  }
});

test("an address outside the list is refused", () => {
  assert.equal(isAdminEmail("someone@else.com", "info@chanlyst.com"), false);
  // No substring or suffix matching: a lookalike domain must not pass.
  assert.equal(isAdminEmail("info@chanlyst.com.evil.com", "info@chanlyst.com"), false);
  assert.equal(isAdminEmail("xinfo@chanlyst.com", "info@chanlyst.com"), false);
});
